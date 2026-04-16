// ---- CORE IMPORTS ---- //
import type {Client} from '@/goovee/.generated/client';
import {
  AOSPortalAppConfig,
  AOSPortalWorkspace,
} from '@/goovee/.generated/models';
import {ID, Partner, PortalAppConfig, PortalWorkspace, User} from '@/types';
import {clone, getPartnerId} from '@/utils';
import {SelectOptions} from '@goovee/orm';
import {
  ALLOW_ALL_REGISTRATION,
  ALLOW_AOS_ONLY_REGISTRATION,
  SUBAPP_CODES,
} from '@/constants';

export const portalAppConfigFields: SelectOptions<AOSPortalAppConfig> = {
  name: true,
  company: {
    id: true,
    name: true,
    logo: {
      id: true,
    },
  },
  byNewest: true,
  byFeature: true,
  byAToZ: true,
  byZToA: true,
  byLessExpensive: true,
  byMostExpensive: true,
  displayPrices: true,
  mainPrice: true,
  displayTwoPrices: true,
  hidePriceForEmptyPricelist: true,
  confirmOrder: true,
  requestQuotation: true,
  priceAfterLogin: true,
  paymentOptionSet: {
    select: {
      name: true,
      typeSelect: true,
      paymentMode: {
        id: true,
      },
    },
  },
  ticketStatusChangeMethod: true,
  ticketHeroTitle: true,
  ticketHeroBgImage: {
    id: true,
    fileName: true,
  },
  ticketHeroDescription: true,
  ticketHeroOverlayColorSelect: true,
  forumHeroTitle: true,
  forumHeroDescription: true,
  forumHeroOverlayColorSelect: true,
  forumHeroBgImage: {id: true},
  eventHeroTitle: true,
  eventHeroDescription: true,
  eventHeroOverlayColorSelect: true,
  eventHeroBgImage: {id: true},
  newsHeroTitle: true,
  newsHeroDescription: true,
  newsHeroOverlayColorSelect: true,
  newsHeroBgImage: {id: true},
  resourcesHeroTitle: true,
  resourcesHeroDescription: true,
  resourcesHeroOverlayColorSelect: true,
  resourcesHeroBgImage: {id: true},
  allowOnlinePaymentForEcommerce: true,
  carouselList: {
    select: {
      title: true,
      subTitle: true,
      href: true,
      image: {id: true},
    },
  },
  hyperlinkList: {
    select: {
      link: true,
      logo: {id: true},
    },
  },
  allowGuestEventRegistration: true,
  enableRecommendedNews: true,
  enableSocialMediaSharing: true,
  enableComment: true,
  enableNewsComment: true,
  enableEventComment: true,
  socialMediaSelect: true,
  canInviteMembers: true,
  isExistingContactsOnly: true,
  invitationTemplateList: {
    select: {
      localization: {code: true},
      template: {name: true, subject: true, content: true, language: true},
    },
  },
  otpTemplateList: {
    select: {
      localization: {code: true},
      template: {name: true, subject: true, content: true, language: true},
    },
  },
  noMoreStockSelect: true,
  outOfStockQty: true,
  defaultStockLocation: {id: true},
  directoryHeroTitle: true,
  directoryHeroBgImage: {
    id: true,
    fileName: true,
  },
  directoryHeroDescription: true,
  directoryHeroOverlayColorSelect: true,
  nonPublicEmailNotFoundMessage: true,
  canPayInvoice: true,
  allowOnlinePaymentForInvoices: true,
  isShowAllTickets: true,
  isShowMyTickets: true,
  isShowManagedTicket: true,
  isShowCreatedTicket: true,
  isShowResolvedTicket: true,
  ticketingFieldSet: {select: {name: true}},
  ticketingFormFieldSet: {select: {name: true}},
  isDisplayChildTicket: true,
  isDisplayRelatedTicket: true,
  isDisplayTicketParent: true,
  isDisplayAssignmentBtn: true,
  isDisplayCancelBtn: true,
  isDisplayCloseBtn: true,
  isShowPublicationAuthor: true,
  isShowPublicationDate: true,
  isShowPublicationTime: true,
  isDisplayContact: true,
  contactEmailAddress: {address: true},
  contactName: true,
  contactPhone: true,
  isCompanyOrAddressRequired: true,
  payInAdvance: true,
  advancePaymentPercentage: true,
  isHomepageDisplay: true,
  isHomepageDisplayNews: true,
  isHomepageDisplayEvents: true,
  isHomepageDisplayMessage: true,
  isHomepageDisplayResources: true,
  isHomepageDisplayHyperlinks: true,
  homepageHeroTitle: true,
  homepageHeroDescription: true,
  homepageHeroOverlayColorSelect: true,
  homepageHeroBgImage: {id: true},
  isFixedHeader: true,
  chatDisplayTypeSelect: true,
  termsOfUseAcceptanceText: true,
};

export async function findWorkspaceMembers({
  url,
  client,
  partnerId,
}: {
  url?: string;
  client: Client;
  partnerId: Partner['id'];
}) {
  if (!(url && partnerId)) {
    return {
      partners: [],
      contacts: [],
    };
  }

  const memberPartners = await client.aOSPartner.find({
    where: {
      isContact: false,
      id: partnerId,
      isActivatedOnPortal: true,
      partnerWorkspaceSet: {
        workspace: {
          url,
        },
      },
    },
    select: {
      id: true,
      firstName: true,
      name: true,
      fullName: true,
      picture: {id: true},
      isContact: true,
      emailAddress: {
        address: true,
      },
    },
  });

  const memberContacts = await client.aOSPartner
    .find({
      where: {
        isContact: true,
        isActivatedOnPortal: true,
        mainPartner: {
          id: partnerId,
        },
        contactWorkspaceConfigSet: {
          portalWorkspace: {
            url,
          },
        },
      },
      select: {
        id: true,
        firstName: true,
        name: true,
        fullName: true,
        picture: {id: true},
        isContact: true,
        emailAddress: {
          address: true,
        },
        contactWorkspaceConfigSet: {
          where: {portalWorkspace: {url}},
          select: {
            isAdmin: true,
            portalWorkspace: {
              url: true,
            },
            contactAppPermissionList: {
              select: {
                app: {
                  name: true,
                  code: true,
                  isInstalled: true,
                },
                roleSelect: true,
              },
            },
          },
        },
      },
    })
    .then((contacts: any) =>
      contacts?.map((c: any) => ({
        ...c,
        contactWorkspaceConfig: c?.contactWorkspaceConfigSet?.[0],
      })),
    );

  return {
    partners: memberPartners,
    contacts: memberContacts,
  };
}

export async function findContactWorkspaceConfig({
  url,
  partnerId,
  contactId,
  client,
}: {
  url?: string;
  partnerId: Partner['id'];
  contactId: ID;
  client: Client;
}) {
  if (!(url && contactId && partnerId)) return null;

  const contact = await client.aOSPartner.findOne({
    where: {
      id: contactId,
    },
    select: {
      contactWorkspaceConfigSet: {
        where: {
          portalWorkspace: {
            url,
          },
          partner: {
            id: partnerId,
          },
        },
        select: {
          isAdmin: true,
          contactAppPermissionList: {
            select: {
              roleSelect: true,
              app: {
                background: true,
                orderForMySpaceMenu: true,
                showInMySpace: true,
                code: true,
                showInTopMenu: true,
                color: true,
                icon: true,
                isInstalled: true,
                name: true,
                orderForTopMenu: true,
              },
            },
          },
        },
      },
    },
  });

  const contactWorkpace: any = contact?.contactWorkspaceConfigSet?.[0];

  const apps = contactWorkpace?.contactAppPermissionList?.map((w: any) => ({
    ...w.app,
    role: w.roleSelect,
  }));

  return {
    ...contactWorkpace,
    apps,
  };
}

export async function findPartnerWorkspaceConfig({
  url,
  partnerId,
  client,
}: {
  url: string;
  partnerId?: ID;
  client: Client;
}) {
  if (!(url && partnerId)) return null;

  const res: any = await client.aOSPartner.findOne({
    where: {
      id: partnerId,
    },
    select: {
      partnerWorkspaceSet: {
        where: {
          workspace: {
            url,
          },
        },
        select: {
          portalAppConfig: portalAppConfigFields,
          apps: {
            select: {
              background: true,
              orderForMySpaceMenu: true,
              showInMySpace: true,
              code: true,
              showInTopMenu: true,
              color: true,
              icon: true,
              isInstalled: true,
              name: true,
              orderForTopMenu: true,
            },
          },
        },
      },
    },
  });

  if (!res?.partnerWorkspaceSet?.length) {
    return null;
  }

  const partnerWorkspaceConfig = res.partnerWorkspaceSet[0];

  if (!partnerWorkspaceConfig) return null;

  return {
    config: partnerWorkspaceConfig?.portalAppConfig,
    apps: partnerWorkspaceConfig?.apps,
    workspacePermissionConfig: {id: partnerWorkspaceConfig.id},
  };
}

export async function findDefaultPartnerWorkspaceConfig({
  url,
  client,
}: {
  url: string;
  client: Client;
}) {
  if (!url) return null;

  const workspace: any = await client.aOSPortalWorkspace.findOne({
    where: {
      url: {
        like: url,
      },
    },
    select: {
      defaultPartnerWorkspace: {
        apps: {
          select: {
            background: true,
            orderForMySpaceMenu: true,
            showInMySpace: true,
            code: true,
            showInTopMenu: true,
            color: true,
            icon: true,
            isInstalled: true,
            name: true,
            orderForTopMenu: true,
          },
        },
        portalAppConfig: portalAppConfigFields,
      },
    },
  });

  return workspace?.defaultPartnerWorkspace;
}

export async function findDefaultPartnerWorkspace({
  partnerId,
  client,
}: {
  partnerId?: ID;
  client: Client;
}) {
  if (!partnerId) return null;

  const res: any = await client.aOSPartner.findOne({
    where: {
      id: partnerId,
    },
    select: {
      defaultWorkspace: {
        workspace: {
          url: true,
        },
      },
    },
  });

  return res?.defaultWorkspace;
}

export async function findDefaultGuestWorkspaceConfig({
  url,
  client,
}: {
  url: string;
  client: Client;
}) {
  if (!url) return null;

  const workspace: any = await client.aOSPortalWorkspace.findOne({
    where: {
      url: {
        like: url,
      },
    },
    select: {
      defaultGuestWorkspace: {
        apps: {
          select: {
            background: true,
            orderForMySpaceMenu: true,
            showInMySpace: true,
            code: true,
            showInTopMenu: true,
            color: true,
            icon: true,
            isInstalled: true,
            name: true,
            orderForTopMenu: true,
          },
        },
        portalAppConfig: portalAppConfigFields,
      },
    },
  });

  const defaultGuestWorkspaceConfig = workspace?.defaultGuestWorkspace;

  if (!defaultGuestWorkspaceConfig) return null;

  return {
    config: defaultGuestWorkspaceConfig?.portalAppConfig,
    apps: defaultGuestWorkspaceConfig?.apps,
    workspacePermissionConfig: {id: workspace?.defaultGuestWorkspace?.id},
  };
}

export async function findWorkspace({
  url = '',
  user,
  client,
}: {
  url?: string;
  user?: User;
  client: Client;
}): Promise<PortalWorkspace | null> {
  if (!url) return null;

  const workspace = await client.aOSPortalWorkspace.findOne({
    where: {
      url: {
        like: url,
      },
    },
    select: {
      name: true,
      url: true,
      defaultTheme: {name: true, css: true},
      navigationSelect: true,
      user: {id: true},
      workspaceLogo: {
        id: true,
      },
    },
  });

  if (!workspace) return null;

  let workspaceConfig;

  if (user) {
    const partnerId = getPartnerId(user);

    const partnerWorkspaceConfig = await findPartnerWorkspaceConfig({
      partnerId,
      url,
      client,
    });

    if (partnerWorkspaceConfig?.config) {
      workspaceConfig = partnerWorkspaceConfig;
    }
  } else {
    const defaultGuestWorkspaceConfig = await findDefaultGuestWorkspaceConfig({
      url,
      client,
    });

    if (defaultGuestWorkspaceConfig?.config) {
      workspaceConfig = defaultGuestWorkspaceConfig;
    }
  }

  const workspacePermissionConfig = workspaceConfig?.workspacePermissionConfig;
  let config = workspaceConfig?.config;
  let apps: any[] = workspaceConfig?.apps;

  if (!config) {
    config = null;
  }

  apps = apps || [];

  const {
    id,
    name,
    version,
    defaultTheme: theme,
    navigationSelect = 'leftSide',
    user: workspaceUser,
    workspaceLogo: logo,
  } = workspace;

  return {
    id,
    name,
    version,
    workspaceUser,
    theme,
    url,
    config,
    apps,
    navigationSelect,
    workspacePermissionConfig,
    logo,
  };
}

export async function findOpenWorkspaces({
  url,
  client,
}: {
  url?: string;
  client: Client;
}) {
  const workspaces = await client.aOSPortalWorkspace
    .find({
      where: {
        url: {
          like: `${url}%`,
        },
      },
      select: {
        name: true,
        url: true,
        allowRegistrationSelect: true,
        defaultGuestWorkspace: {
          apps: {
            select: {
              background: true,
              orderForMySpaceMenu: true,
              showInMySpace: true,
              code: true,
              showInTopMenu: true,
              color: true,
              icon: true,
              isInstalled: true,
              name: true,
              orderForTopMenu: true,
            },
          },
        },
      },
      orderBy: {updatedOn: 'DESC'} as any,
    })
    .then(workspaces => {
      return (workspaces || [])?.filter(
        workspace => workspace?.defaultGuestWorkspace?.apps?.length,
      );
    });

  return workspaces;
}

export async function findPartnerWorkspaces({
  url,
  partnerId,
  client,
}: {
  url?: string;
  partnerId: ID;
  client: Client;
}) {
  if (!partnerId) return [];

  const res: any = await client.aOSPartner
    .findOne({
      where: {
        id: partnerId,
      },
      select: {
        partnerWorkspaceSet: {
          where: {
            ...(url
              ? {
                  workspace: {
                    url: {
                      like: `${url}%`,
                    },
                  },
                }
              : {}),
          },
          select: {
            workspace: {
              id: true,
              name: true,
              url: true,
              allowRegistrationSelect: true,
            },
          },
        },
      },
    })
    .then(clone);

  if (!res?.partnerWorkspaceSet?.length) {
    return [];
  }

  return res?.partnerWorkspaceSet
    .map((item: any) => item.workspace)
    .filter(Boolean);
}

export async function findContactWorkspaces({
  url,
  partnerId,
  contactId,
  client,
}: {
  url?: string;
  partnerId: ID;
  contactId: ID;
  client: Client;
}) {
  if (!(partnerId && contactId)) return [];

  const partnerWorkspaces = await findPartnerWorkspaces({
    url,
    partnerId,
    client,
  });

  if (!partnerWorkspaces?.length) return [];

  const res: any = await client.aOSPartner
    .findOne({
      where: {
        id: contactId,
      },
      select: {
        contactWorkspaceConfigSet: {
          where: {
            ...(url
              ? {
                  portalWorkspace: {
                    url: {
                      like: `${url}%`,
                    },
                  },
                }
              : {}),
            partner: {
              id: partnerId,
            },
          },
          select: {
            portalWorkspace: {
              id: true,
              name: true,
              url: true,
              allowRegistrationSelect: true,
            },
          },
        },
      },
    })
    .then(clone);

  if (!res?.contactWorkspaceConfigSet?.length) {
    return [];
  }

  const partnerWorkspaceAccess = (workspace: any) => {
    return partnerWorkspaces.some((w: any) => w.id === workspace?.id);
  };

  return res?.contactWorkspaceConfigSet
    .map((item: any) => item.portalWorkspace)
    .filter(partnerWorkspaceAccess)
    .filter(Boolean);
}

export async function findWorkspaceByURL({
  url,
  client,
}: {
  url: string;
  client: Client;
}) {
  if (!url) return null;

  return client.aOSPortalWorkspace.findOne({
    where: {
      url,
    },
    select: {
      name: true,
      navigationSelect: true,
      url: true,
      defaultGuestWorkspace: {id: true, name: true},
      defaultTheme: {css: true, name: true},
      defaultPartnerWorkspace: {id: true, name: true},
      allowRegistrationSelect: true,
    },
  });
}

export async function findWorkspaceForRegistration({
  url,
  client,
}: {
  url: PortalWorkspace['url'];
  client: Client;
}): Promise<(AOSPortalWorkspace & {config?: PortalAppConfig}) | null> {
  if (!url) {
    return null;
  }

  try {
    const workspace = await client.aOSPortalWorkspace
      .findOne({
        where: {
          url: {
            like: `${url}%`,
          },
          AND: [
            {
              OR: [
                {
                  allowRegistrationSelect: ALLOW_ALL_REGISTRATION,
                },
                {
                  allowRegistrationSelect: ALLOW_AOS_ONLY_REGISTRATION,
                },
              ],
            },
          ],
        },
        select: {
          name: true,
          url: true,
          allowRegistrationSelect: true,
          defaultGuestWorkspace: {
            apps: {
              select: {
                background: true,
                orderForMySpaceMenu: true,
                showInMySpace: true,
                code: true,
                showInTopMenu: true,
                color: true,
                icon: true,
                isInstalled: true,
                name: true,
                orderForTopMenu: true,
              },
            },
            portalAppConfig: {
              termsOfUseAcceptanceText: true,
            },
          },
        },
      })
      .then(clone);

    if (!workspace) return null;

    return {
      ...workspace,
      config: workspace.defaultGuestWorkspace?.portalAppConfig,
    };
  } catch (err) {}

  return null;
}

export async function canRegisterForWorkspace({
  url,
  client,
}: {
  url: PortalWorkspace['url'];
  client: Client;
}): Promise<boolean> {
  if (!url) {
    return false;
  }

  return findWorkspaceForRegistration({url, client}).then(workspace =>
    Boolean(workspace?.id),
  );
}

export async function findWorkspaces({
  url,
  user,
  client,
}: {
  url?: string;
  user?: User;
  client: Client;
}) {
  if (!url) return [];

  if (!user) {
    return findOpenWorkspaces({url, client});
  }

  if (!user.isContact) {
    return findPartnerWorkspaces({
      url,
      partnerId: user.id,
      client,
    });
  }

  if (user.isContact) {
    return findContactWorkspaces({
      url,
      contactId: user.id,
      partnerId: user.mainPartnerId!,
      client,
    });
  }

  return [];
}

export async function findWorkspaceApps({
  url,
  user,
  client,
}: {
  url?: string;
  user?: User;
  client: Client;
}) {
  const workspace = await findWorkspace({url, user, client});

  const apps = workspace?.apps;

  if (!apps) {
    return [];
  }

  if (!user || !user.isContact) {
    return apps;
  }

  const contactWorkpaceConfig = await findContactWorkspaceConfig({
    url: workspace.url,
    contactId: user.id,
    partnerId: user.mainPartnerId!,
    client,
  });

  if (contactWorkpaceConfig.isAdmin) {
    return apps.map(app => ({...app, isContactAdmin: true}));
  }

  const available = (app: any) =>
    apps.some(a => a.code === app.code && a.isInstalled);

  const contactApps = (contactWorkpaceConfig?.apps || []).filter(available);

  return contactApps;
}

export async function findSubapps({
  url,
  user,
  client,
}: {
  url: string;
  user?: User;
  client: Client;
}) {
  const apps = await findWorkspaceApps({
    url,
    user,
    client,
  }).then(clone);

  return apps;
}

export async function findSubapp({
  code,
  url,
  user,
  client,
}: {
  code: string;
  url: string;
  user?: User;
  client: Client;
}) {
  const subapps = await findSubapps({url, user, client});

  return subapps.find((app: any) => app.code === code);
}

export async function findSubappAccess({
  code,
  user,
  url,
  client,
}: {
  code: string;
  user: any;
  url: string;
  client: Client;
}) {
  if (!(code && url)) return null;

  const subapp = await findSubapp({code, url, user, client});

  if (!subapp?.isInstalled) return null;

  return subapp;
}
