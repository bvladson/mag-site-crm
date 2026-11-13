import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Sem sessão ou sem papel (painel) não adianta repetir: o aviso de permissão aparece na hora, sem "Carregando..." longo.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: (failures, error) => !(error instanceof Error && /^(Unauthorized|Forbidden):/.test(error.message)) && failures < 3 },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    trailingSlash: "preserve",
    defaultPreloadStaleTime: 0,
  });

  return router;
};
