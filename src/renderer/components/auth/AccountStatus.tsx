import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function AccountStatus() {
  const {
    canvasConnected,
    gradescopeConnected,
    pearsonConnected,
    googleConnected,
    checking,
    checkStatus,
    loginCanvas,
    loginGradescope,
    loginPearson,
    loginGoogle,
    logoutGoogle,
  } = useAuthStore();

  useEffect(() => {
    checkStatus();

    const unsubscribe = window.electronAPI.onAuthStatusChanged((status) => {
      useAuthStore.getState().setStatus(status.canvas, status.gradescope, status.pearson, status.google);
    });

    return unsubscribe;
  }, []);

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Accounts
      </p>
      <StatusRow
        label="Canvas"
        connected={canvasConnected}
        checking={checking}
        onLogin={loginCanvas}
      />
      <StatusRow
        label="Gradescope"
        connected={gradescopeConnected}
        checking={checking}
        onLogin={loginGradescope}
      />
      <StatusRow
        label="Pearson"
        connected={pearsonConnected}
        checking={checking}
        onLogin={loginPearson}
      />
      <StatusRow
        label="Google Calendar"
        connected={googleConnected}
        checking={checking}
        onLogin={loginGoogle}
        onLogout={logoutGoogle}
      />
    </div>
  );
}

function StatusRow({
  label,
  connected,
  checking,
  onLogin,
  onLogout,
}: {
  label: string;
  connected: boolean;
  checking: boolean;
  onLogin: () => void;
  onLogout?: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'w-2 h-2 rounded-full',
            checking ? 'bg-muted-foreground' : connected ? 'bg-green-500' : 'bg-red-500',
          )}
        />
        <span className="text-xs text-foreground">{label}</span>
      </div>
      {!checking && !connected && (
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={onLogin}>
          Sign in
        </Button>
      )}
      {!checking && connected && onLogout && (
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-muted-foreground" onClick={onLogout}>
          Sign out
        </Button>
      )}
    </div>
  );
}
