import { Brand, DemoBanner } from "@/components/brand";
import { getConfig } from "@/lib/config/env";
import { getPreferences } from "@/lib/preferences";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { dict } = await getPreferences();
  return (
    <div className="flex min-h-screen flex-col">
      {getConfig().mode === "demo" && <DemoBanner text={dict.demoBanner} />}
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center">
            <Brand />
          </div>
          <div className="rounded-xl border border-border bg-surface p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
