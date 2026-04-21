'use client';

// ---- LOCAL IMPORTS ---- //
import {RegistrationForm} from '@/subapps/events/common/ui/components';
import type {Cloned} from '@/types/util';
import {PortalWorkspace} from '@/orm/workspace';

const Content = ({
  eventDetails,
  metaFields,
  workspace,
  user,
}: {
  eventDetails: any;
  metaFields: any;
  workspace: PortalWorkspace | Cloned<PortalWorkspace>;
  user: any;
}) => {
  return (
    <>
      <main className="container mx-auto  flex-1 py-6 flex flex-col lg:flex-row gap-6 pb-20">
        <div className="order-2 lg:order-1 space-y-6 w-full">
          <RegistrationForm
            eventDetails={eventDetails}
            metaFields={metaFields}
            workspace={workspace}
            user={user}
          />
        </div>
      </main>
    </>
  );
};

export default Content;
