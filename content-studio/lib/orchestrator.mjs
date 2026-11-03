// The orchestrator: hands work to the agents in order, records every run,
// moves each post through its states and runs the scheduler.
//
// Post states:
//   idea -> writing -> checking -> review (waiting for approval)
//        -> scheduled -> ready (post by hand) / posted;  failed on errors
import { AGENTS } from "./agents.mjs";
import { BudgetError, describeError } from "./claude.mjs";
import { sendWebhook } from "./connectors.mjs";

const MAX_REVIEW_ROUNDS = 2;

// "2026-10-26" + 2 days at "19:00" WIB -> ISO timestamp.
export function wibTimestamp(weekStart, day, time) {
  const base = new Date(`${weekStart}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + day);
  const date = base.toISOString().slice(0, 10);
  const hhmm = /^\d{2}:\d{2}$/.test(time) ? time : "19:00";
  return new Date(`${date}T${hhmm}:00+07:00`).toISOString();
}

export function createOrchestrator({ store, claude, connectors, log = console }) {
  // One job at a time keeps runs easy to follow and the JSON file consistent.
  let chain = Promise.resolve();
  let pending = 0;
  const enqueue = (label, fn) => {
    pending++;
    const job = chain.then(fn).catch((error) => log.error(`${label}: ${error.message}`)).finally(() => pending--);
    chain = job;
    return job;
  };

  function emit(type, data) {
    const event = store.addEvent(type, data);
    sendWebhook(event);
    return event;
  }

  async function callAgent(name, input, postId) {
    const agent = AGENTS[name];
    const settings = store.settings;
    const run = store.startRun({ agent: name, postId: postId || null, model: claude.demo ? "demo" : agent.model });
    try {
      if (!claude.demo && store.costThisMonthUsd() >= settings.monthlyBudgetUsd) {
        throw new BudgetError(`Batas biaya bulan ini (US$${settings.monthlyBudgetUsd}) sudah tercapai`);
      }
      let data;
      let usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      if (claude.demo) {
        await new Promise((r) => setTimeout(r, 150));
        data = agent.demo(settings, input);
      } else {
        const result = await claude.json({
          model: agent.model,
          effort: agent.effort,
          system: agent.system(settings),
          prompt: agent.prompt(settings, input),
          schema: agent.schema,
        });
        data = result.data;
        usage = result.usage;
      }
      store.finishRun(run.id, { status: "ok", ...usage, output: data });
      return data;
    } catch (error) {
      const message = describeError(error);
      store.finishRun(run.id, { status: "error", error: message });
      emit("agent.failed", { agent: name, postId, error: message });
      throw new Error(message);
    }
  }

  // Writer -> Designer -> Reviewer, with up to MAX_REVIEW_ROUNDS rewrites.
  async function processPost(postId, fixes = []) {
    let post = store.getPost(postId);
    if (!post) return;
    try {
      for (let round = 0; ; round++) {
        store.updatePost(postId, { status: "writing" });
        const written = await callAgent("writer", { post, fixes }, postId);
        post = store.updatePost(postId, { ...written, attempts: post.attempts + 1 }, round ? "Ditulis ulang oleh Writer" : "Ditulis oleh Writer");

        const design = await callAgent("designer", { post }, postId);
        post = store.updatePost(postId, { design });

        store.updatePost(postId, { status: "checking" });
        const review = await callAgent("reviewer", { post }, postId);
        post = store.updatePost(postId, { review });
        if (review.pass || round + 1 >= MAX_REVIEW_ROUNDS) break;
        fixes = review.fixes;
      }

      if (store.settings.requireApproval) {
        post = store.updatePost(postId, { status: "review" }, "Menunggu persetujuan");
        emit("post.ready_for_review", { postId, topic: post.topic, scheduledAt: post.scheduledAt });
      } else {
        post = store.updatePost(postId, { status: "scheduled" }, "Dijadwalkan otomatis (tanpa persetujuan)");
        emit("post.scheduled", { postId });
      }
    } catch (error) {
      store.updatePost(postId, { status: "failed", error: error.message }, `Gagal: ${error.message}`);
    }
  }

  return {
    get busy() {
      return pending > 0;
    },

    planWeek({ weekStart, count, notes }) {
      const settings = store.settings;
      const total = Math.max(1, Math.min(21, Number(count) || settings.postsPerWeek));
      return enqueue("planWeek", async () => {
        emit("plan.started", { weekStart, count: total });
        let plan;
        try {
          plan = await callAgent("planner", { weekStart, count: total, notes });
        } catch {
          return;
        }
        const ids = plan.ideas.slice(0, total).map((idea) =>
          store.createPost({
            ...idea,
            weekStart,
            scheduledAt: wibTimestamp(weekStart, Math.max(0, Math.min(6, idea.day)), idea.time),
          }).id,
        );
        emit("plan.created", { weekStart, posts: ids.length });
        for (const postId of ids) enqueue("processPost", () => processPost(postId));
      });
    },

    // A post idea typed in by hand goes straight to the Writer.
    addIdea(fields) {
      const post = store.createPost(fields);
      emit("post.created", { postId: post.id });
      enqueue("processPost", () => processPost(post.id));
      return post;
    },

    rewrite(postId, note) {
      const post = store.updatePost(postId, { status: "writing" }, note ? `Diminta ubah: ${note}` : "Diminta tulis ulang");
      if (!post) return null;
      enqueue("rewrite", () => processPost(postId, note ? [note] : []));
      return post;
    },

    approve(postId) {
      const post = store.getPost(postId);
      if (!post || !["review", "failed"].includes(post.status) || !post.caption) return null;
      const updated = store.updatePost(postId, { status: "scheduled", approvedAt: new Date().toISOString() }, "Disetujui");
      emit("post.approved", { postId });
      return updated;
    },

    markPosted(postId, url) {
      const post = store.updatePost(postId, { status: "posted", postedAt: new Date().toISOString(), postUrl: url || "" }, "Sudah diposting");
      if (post) emit("post.published", { postId, platform: post.platform, url: post.postUrl });
      return post;
    },

    // Called every minute: hands due posts to their platform connector.
    tick(now = new Date()) {
      for (const post of store.listPosts()) {
        if (post.status !== "scheduled" || Date.parse(post.scheduledAt) > now.getTime()) continue;
        try {
          const result = connectors.get(post.platform).publish(post);
          if (result.done) {
            store.updatePost(post.id, { status: "posted", postedAt: now.toISOString(), postUrl: result.url || "" }, "Diposting otomatis");
            emit("post.published", { postId: post.id, platform: post.platform, url: result.url });
          } else {
            store.updatePost(post.id, { status: "ready" }, result.note);
            emit("post.ready_to_post", { postId: post.id, platform: post.platform });
          }
        } catch (error) {
          store.updatePost(post.id, { status: "failed", error: error.message }, `Gagal posting: ${error.message}`);
          emit("post.failed", { postId: post.id, error: error.message });
        }
      }
    },

    idle: () => chain,
  };
}
