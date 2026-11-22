/** Report role groups, mirrored by public.app_role_group() in database/security/access/app_role_groups.sql. Change both together. */
export const REPORT_READ = ['SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER', 'ACCOUNTANT', 'FINANCE_MANAGER'] as const;
export const FINANCE_READ = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'FINANCE_MANAGER'] as const;
export const STOCK_READ = ['SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER'] as const;
export const STOCK_THRESHOLD_WRITE = ['SUPER_ADMIN', 'STORE_MANAGER'] as const;
