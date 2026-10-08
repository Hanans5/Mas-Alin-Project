/// <reference path="../pb_data/types.d.ts" />
// A4 invoice to send to the pelanggan (2026-10-08). sales.invoice_token is
// the unguessable key of the public read-only link (hidden from the API; ""
// = no link, so clearing it revokes the link). Settings: invoice terms
// (empty = the struk footer) and an optional promo panel.
migrate((app) => {
  const sales = app.findCollectionByNameOrId("sales");
  sales.fields.add(new TextField({ name: "invoice_token", hidden: true, max: 64 }));
  sales.addIndex("idx_sales_invoice_token", true, "invoice_token", "invoice_token != ''");
  app.save(sales);
  const st = app.findCollectionByNameOrId("settings");
  st.fields.add(new TextField({ name: "invoice_terms", max: 3000 }));
  st.fields.add(new FileField({ name: "promo_image", maxSelect: 1, maxSize: 5242880, mimeTypes: ["image/jpeg", "image/png", "image/webp"] }));
  st.fields.add(new TextField({ name: "promo_title", max: 120 }));
  st.fields.add(new DateField({ name: "promo_until" }));
  app.save(st);
}, (app) => {
  const sales = app.findCollectionByNameOrId("sales");
  sales.removeIndex("idx_sales_invoice_token");
  sales.fields.removeByName("invoice_token");
  app.save(sales);
  const st = app.findCollectionByNameOrId("settings");
  for (const f of ["invoice_terms", "promo_image", "promo_title", "promo_until"]) st.fields.removeByName(f);
  app.save(st);
});
