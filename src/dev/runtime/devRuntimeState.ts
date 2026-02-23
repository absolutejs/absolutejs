export interface ActiveRuntimeInfo {
    route: string;
    framework: string;
    type: 'page' | 'api';
    ssrEnabled?: boolean;
    hydrationMode?: string;
    hmrStrategy?: string;
    zoneless?: boolean;
    lastAccessed: number;
    accessCount: number;
}

let activeRuntime: ActiveRuntimeInfo | null = null;

export function setActiveRuntime(info: ActiveRuntimeInfo) {
    if (activeRuntime && activeRuntime.route === info.route) {
        activeRuntime.accessCount++;
        activeRuntime.lastAccessed = info.lastAccessed;
    } else {
        activeRuntime = {
            ...info,
            accessCount: 1
        };
    }
}

export function getActiveRuntime() {
    return activeRuntime;
}
