S536 Brevo webhook setup
1. In Brevo, open Transactional > Settings > Webhooks.
2. Add URL: `<app>/api/inbound/brevo-events?token=<BREVO_WEBHOOK_TOKEN>`.
3. Use the production Vacantless app URL for `<app>`.
4. Set `BREVO_WEBHOOK_TOKEN` in Vercel as a server-only env var.
5. Redeploy after adding the env var.
6. Until the env var is set and redeployed, the endpoint returns 404.
7. Tick delivered, hard bounce, soft bounce, blocked, spam, and opened.
8. Do not tick unrelated marketing-list events for this endpoint.
9. Migrations 0170 and 0171 need Supabase MCP apply/readback on Noam's go.
