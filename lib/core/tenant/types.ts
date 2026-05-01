import {GooveeClient} from '@goovee/generated/client';

export type Tenant = {
  id: string;
  config: TenantConfig;
  client: TenantClient;
};

export type TenantConfig = {
  db: {
    url: string;
  };
  aos: {
    url: string;
    storage: string;
    auth: {
      username: string;
      password: string;
    };
  };
};

export type TenantClient = GooveeClient;
