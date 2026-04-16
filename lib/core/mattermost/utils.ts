import {getEnv} from '@/environment';
import {type TenantConfig} from '@/tenant';

/**
 * Get the Mattermost host URL from environment variables
 */
export function getHost(): string {
  return (
    getEnv()?.GOOVEE_PUBLIC_MATTERMOST_HOST ||
    process.env.GOOVEE_PUBLIC_MATTERMOST_HOST ||
    ''
  );
}

export function getAdminToken(): string {
  return getEnv()?.MATTERMOST_TOKEN || process.env.MATTERMOST_TOKEN || '';
}

export function isCreateMattermostUsersEnabled(): boolean {
  const envValue =
    getEnv()?.CREATE_MATTERMOST_USERS || process.env.CREATE_MATTERMOST_USERS;
  return envValue === 'true';
}

export function getAosUrl(config: TenantConfig): string {
  return config?.aos?.url;
}

export function getBasicAuthCredentials(config: TenantConfig): {
  username: string;
  password: string;
} {
  return config.aos.auth;
}
