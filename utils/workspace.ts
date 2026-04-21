export function workspacePathname(params: {
  tenant: string;
  workspace: string;
}): {
  tenant: string;
  workspace: string;
  workspaceURI: string;
  workspaceURL: string;
} {
  const {tenant, workspace} = params;

  const workspaceURI = `/${tenant}/${workspace}`;
  const workspaceURL = `${process.env.GOOVEE_PUBLIC_HOST}${workspaceURI}`;

  return {
    tenant,
    workspace,
    workspaceURI,
    workspaceURL,
  };
}
