export const navItems = [
  {
    id: 'home',
    label: 'Dashboard',
    path: '/',
    description: 'Study hub overview and navigation.',
  },
  {
    id: 'oidc-labs',
    label: 'OIDC/OAuth Exam Labs',
    path: '/labs',
    description: 'Hands-on PingOne OAuth 2.0 and OpenID Connect integration patterns.',
  },
];

export function getNavItem(id) {
  return navItems.find((item) => item.id === id);
}
