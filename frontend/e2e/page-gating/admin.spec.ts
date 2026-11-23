import { describePage } from "./matrix";

describePage("/admin");
describePage("/admin/review");
describePage("/admin/disputes");
describePage("/admin/resolve");
describePage("/admin/stats");
describePage("/admin/users");

// The resolution queue's old URL redirects (next.config.ts) before the proxy
// gate runs, so it must gate exactly like /admin/resolve.
describePage("/admin/resolve", { visit: "/admin/admin-review" });
