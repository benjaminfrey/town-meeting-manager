import { Outlet } from "react-router";
import { APP_NAME } from "@town-meeting/shared";

export default function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Civic software for New England town government
          </p>
        </div>

        {/* Content */}
        <Outlet />
      </div>
    </div>
  );
}
