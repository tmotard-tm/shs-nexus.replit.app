interface PublicFormRouteProps {
  children: React.ReactNode;
}

export function PublicFormRoute({ children }: PublicFormRouteProps) {
  return (
    <>
      <div className="dev-banner">
        🚧 DEVELOPMENT VERSION - CONCEPT MODEL ONLY - NOT FOR PRODUCTION USE 🚧
      </div>
      <div className="min-h-screen bg-background">
        <div className="w-full">
          {children}
        </div>
      </div>
    </>
  );
}