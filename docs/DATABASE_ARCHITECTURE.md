# Future Radius Database Architecture

Future Radius uses project tables as the source of truth. FreeRADIUS tables are generated runtime tables only.

## Source Of Truth

- Identity and access: `tenants`, `branches`, `users`, `roles`, `permissions`, `role_permissions`, `user_roles`.
- Customers and subscribers: `customers`, `customer_contacts`, `customer_addresses`, `subscribers`, `subscriber_credentials`, `subscriber_status_history`, `subscriber_packages`, `subscriber_static_ips`.
- Packages and policy: `packages`, `package_speed_profiles`, `package_quota_profiles`, `package_fup_rules`.
- NAS and sync control: `nas_devices` (application source of truth for routers), `radius_groups`, `radius_group_attributes`, `subscriber_radius_attributes`, `radius_sync_jobs`, `radius_sync_logs`. Some older databases may still have a legacy `nas_servers` table; the API prefers `nas_devices` and may read `nas_servers` only for encrypted-secret legacy rows where that table still exists.
- Accounting rollups: `sessions`, `session_interim_updates`, `usage_counters`, `usage_daily`, `usage_monthly`.
- Billing and payments: `invoices`, `invoice_items`, `payments`, `wallet_transactions`, `payment_methods`.
- Notifications and operations: `notification_templates`, `notifications`, `whatsapp_messages`, `background_jobs`, `system_health_events`, `backups`, `api_tokens`.

## Runtime Tables

FreeRADIUS reads only the generated runtime tables:

- `nas`
- `radcheck`
- `radreply`
- `radgroupcheck`
- `radgroupreply`
- `radusergroup`
- `radacct`
- `radpostauth`
- `radippool`

`radacct` is raw accounting input. It is not the source of truth for subscribers, packages, or billing.

## Sync Model

`RadiusSyncService` renders runtime rows from project tables:

- Subscribers generate `radcheck`, `radreply`, and `radusergroup`.
- Packages generate `radgroupreply`.
- NAS devices generate `nas`.
- Disabled subscribers are rendered as rejected accounts.
- Package changes trigger regeneration of group attributes.

## Removed Legacy

Legacy external schemas are not part of runtime and are not supported.
