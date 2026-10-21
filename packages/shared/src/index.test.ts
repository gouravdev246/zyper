import { describe, it, expect } from 'vitest';
import { RunStatus, ToolCategory, IPC_CHANNELS } from './index.js';

describe('Shared Package Exports', () => {
  it('should export all RunStatus states properly', () => {
    expect(RunStatus.PENDING).toBe('PENDING');
    expect(RunStatus.RUNNING).toBe('RUNNING');
    expect(RunStatus.WAITING_FOR_APPROVAL).toBe('WAITING_FOR_APPROVAL');
    expect(RunStatus.COMPLETED).toBe('COMPLETED');
    expect(RunStatus.FAILED).toBe('FAILED');
    expect(RunStatus.CANCELLED).toBe('CANCELLED');
  });

  it('should define tool categories', () => {
    expect(ToolCategory.READ_ONLY).toBe('READ_ONLY');
    expect(ToolCategory.PREPARATORY).toBe('PREPARATORY');
    expect(ToolCategory.CONSEQUENTIAL).toBe('CONSEQUENTIAL');
  });

  it('should export IPC channels dictionary', () => {
    expect(IPC_CHANNELS.GET_APP_VERSION).toBe('zyper:get-app-version');
    expect(IPC_CHANNELS.API_REQUEST).toBe('zyper:api-request');
  });
});
