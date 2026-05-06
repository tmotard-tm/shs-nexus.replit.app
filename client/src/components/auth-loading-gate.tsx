import { useAuth } from "@/hooks/use-auth";
import { PageSpinner } from "@/components/ui/page-spinner";

interface AuthLoadingGateProps {
  children: React.ReactNode;
}

export function AuthLoadingGate({ children }: AuthLoadingGateProps) {
  const { isLoading } = useAuth();

  if (isLoading) {
    return <PageSpinner />;
  }

  return <>{children}</>;
}
