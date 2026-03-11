import { Calendar, Building2, Home } from "lucide-react";

export default function Portal404() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="mx-auto max-w-md text-center">
        <p className="text-6xl font-bold text-gray-300">404</p>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">
          Page Not Found
        </h1>
        <p className="mt-2 text-slate-600">
          The page you&apos;re looking for doesn&apos;t exist or may have been
          moved.
        </p>

        <nav className="mt-8 flex flex-col items-center gap-3" aria-label="Portal navigation">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Back to Home
          </a>
          <a
            href="/meetings"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <Calendar className="h-4 w-4" aria-hidden="true" />
            View Meetings
          </a>
          <a
            href="/boards"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <Building2 className="h-4 w-4" aria-hidden="true" />
            View Boards
          </a>
        </nav>
      </div>
    </div>
  );
}
