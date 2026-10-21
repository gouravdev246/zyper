export interface ZyperBridge {
  getAppVersion: () => Promise<string>;
  getSystemInfo: () => Promise<{
    platform: string;
    release: string;
    arch: string;
    hostname: string;
  }>;
  apiRequest: (endpoint: string, options?: RequestInit) => Promise<any>;
  openExternal: (url: string) => Promise<boolean>;
  onRunEvent: (callback: (event: any) => void) => () => void;
}

declare global {
  interface Window {
    zyper?: ZyperBridge;
  }
}

export {};
