import { QueryClient, QueryObserver } from '@tanstack/query-core';

interface AdminViewResult {
  view: 'overview' | 'sessions' | 'participants' | 'signals';
  title: string;
  generatedAt: number;
  content: string;
}

const root = document.querySelector<HTMLElement>('[data-admin-root]');
const content = document.querySelector<HTMLElement>('#admin-content');
const title = document.querySelector<HTMLElement>('[data-admin-title]');

if (root && content && title) {
  const endpoint = root.dataset.endpoint;
  if (!endpoint) throw new Error('Missing admin data endpoint.');
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchInterval: 15_000,
        retry: 1,
      },
    },
  });
  const queryOptions = () => ({
    queryKey: ['admin-view', location.search],
    queryFn: async (): Promise<AdminViewResult> => {
      const response = await fetch(`${endpoint}${location.search}`, { headers: { accept: 'application/json' } });
      if (response.status === 401) {
        location.reload();
        throw new Error('Admin session expired.');
      }
      if (!response.ok) throw new Error('Could not update the admin dashboard.');
      return response.json() as Promise<AdminViewResult>;
    },
  });
  const observer = new QueryObserver(queryClient, queryOptions());
  observer.subscribe((result) => {
    root.classList.toggle('loading', result.isFetching);
    if (!result.data) return;
    content.innerHTML = result.data.content;
    title.textContent = result.data.title;
    document.title = `${result.data.title} · miseshare admin`;
    document.querySelectorAll<HTMLElement>('[data-view]').forEach((link) => {
      link.classList.toggle('active', link.dataset.view === result.data?.view);
    });
  });

  const navigate = (url: URL, push: boolean) => {
    if (push) history.pushState({}, '', url);
    observer.setOptions(queryOptions());
  };

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-admin-nav]') : null;
    if (!target || !target.href || target.classList.contains('disabled') || event.defaultPrevented) return;
    const url = new URL(target.href);
    if (url.origin !== location.origin) return;
    event.preventDefault();
    navigate(url, true);
  });
  window.addEventListener('popstate', () => navigate(new URL(location.href), false));
}
