import { Card } from "../components/ui/Card";
import { useTheme } from "../context/ThemeContext";
import { Button } from "../components/ui/Button";

export function SettingsPage() {
  const { theme, toggle } = useTheme();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Appearance</div>
            <div className="text-sm opacity-70">Theme: {theme}</div>
          </div>
          <Button type="button" onClick={toggle}>
            Toggle dark / light
          </Button>
        </div>
      </Card>
      <Card>
        <div className="text-sm opacity-80">
          Admin backup: <code className="rounded bg-[hsl(var(--muted))] px-2 py-1">GET /api/admin/extension-export</code>{" "}
          (admin JWT required)
        </div>
      </Card>
    </div>
  );
}
