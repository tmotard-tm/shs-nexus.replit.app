import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Handle FormData differently from JSON data
  const isFormData = data instanceof FormData;
  
  console.log(`[API] ${method} ${url}`, data ? '(with data)' : '(no data)');
  
  const res = await fetch(url, {
    method,
    headers: data && !isFormData ? { "Content-Type": "application/json" } : {},
    body: data ? (isFormData ? data : JSON.stringify(data)) : undefined,
    credentials: "include",
  });

  console.log(`[API] ${method} ${url} -> ${res.status} ${res.statusText}`);
  
  // Log cookie information for debugging
  if (res.status === 401) {
    console.warn(`[API] Authentication failed for ${method} ${url}`);
    const cookieHeader = document.cookie;
    console.warn(`[API] Current cookies:`, cookieHeader || '(none)');
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    console.log(`[QUERY] GET ${url}`);
    
    const res = await fetch(url, {
      credentials: "include",
    });

    console.log(`[QUERY] GET ${url} -> ${res.status} ${res.statusText}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      console.warn(`[QUERY] Authentication failed for ${url}, returning null`);
      const cookieHeader = document.cookie;
      console.warn(`[QUERY] Current cookies:`, cookieHeader || '(none)');
      return null;
    }

    // Log authentication failures for non-null behavior
    if (res.status === 401) {
      console.warn(`[QUERY] Authentication failed for ${url}`);
      const cookieHeader = document.cookie;
      console.warn(`[QUERY] Current cookies:`, cookieHeader || '(none)');
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
