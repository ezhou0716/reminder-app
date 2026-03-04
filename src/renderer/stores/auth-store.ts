import { create } from 'zustand';

interface AuthState {
  canvasConnected: boolean;
  gradescopeConnected: boolean;
  pearsonConnected: boolean;
  googleConnected: boolean;
  checking: boolean;
  setStatus: (canvas: boolean, gradescope: boolean, pearson: boolean, google: boolean) => void;
  checkStatus: () => Promise<void>;
  loginCanvas: () => Promise<boolean>;
  loginGradescope: () => Promise<boolean>;
  loginPearson: () => Promise<boolean>;
  loginGoogle: () => Promise<boolean>;
  logoutGoogle: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  canvasConnected: false,
  gradescopeConnected: false,
  pearsonConnected: false,
  googleConnected: false,
  checking: true,

  setStatus: (canvas, gradescope, pearson, google) =>
    set({ canvasConnected: canvas, gradescopeConnected: gradescope, pearsonConnected: pearson, googleConnected: google, checking: false }),

  checkStatus: async () => {
    set({ checking: true });
    try {
      const status = await window.electronAPI.getAuthStatus();
      set({
        canvasConnected: status.canvas,
        gradescopeConnected: status.gradescope,
        pearsonConnected: status.pearson,
        googleConnected: status.google,
        checking: false,
      });
    } catch {
      set({ checking: false });
    }
  },

  loginCanvas: async () => {
    const success = await window.electronAPI.loginCanvas();
    if (success) {
      set({ canvasConnected: true });
    }
    return success;
  },

  loginGradescope: async () => {
    const success = await window.electronAPI.loginGradescope();
    if (success) {
      set({ gradescopeConnected: true });
    }
    return success;
  },

  loginPearson: async () => {
    const success = await window.electronAPI.loginPearson();
    if (success) {
      set({ pearsonConnected: true });
    }
    return success;
  },

  loginGoogle: async () => {
    const success = await window.electronAPI.loginGoogle();
    if (success) {
      set({ googleConnected: true });
    }
    return success;
  },

  logoutGoogle: async () => {
    await window.electronAPI.logoutGoogle();
    set({ googleConnected: false });
  },
}));
