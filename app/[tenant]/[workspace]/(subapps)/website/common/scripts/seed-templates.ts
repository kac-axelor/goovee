import '@/load-swc-env';
import {seedComponents} from '@/subapps/website/common/utils/templates';
import {manager} from '@/tenant';

const tenantId = process.env.MULTI_TENANCY === 'true' ? process.argv[2] : 'd';

if (!tenantId) {
  console.error('\x1b[31m✖ Tenant id is required.\x1b[0m');
  process.exit(1);
}

manager
  .getTenant(tenantId)
  .then(tenant => {
    if (!tenant) {
      console.error('\x1b[31m✖ Tenant not found.\x1b[0m');
      process.exit(1);
    }
    return seedComponents(tenant.client);
  })
  .then(() =>
    console.log('\x1b[32m🔥 Success:\x1b[0m Templates seeded successfully!'),
  )
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
