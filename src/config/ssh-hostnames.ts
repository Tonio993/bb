export function normalizeSshHostnames(values: readonly string[]): string[] {
    return [...new Set(values.map(normalizeSshHostname))];
}

function normalizeSshHostname(value: string): string {
    try {
        const name = value.trim();
        if (!name || /[\s\\/?#%*@,]/u.test(name)) throw new Error();
        if (name.startsWith("[") ? !name.endsWith("]") : name.includes(":")) throw new Error();
        const host = new URL(`ssh://${name}`);
        if (!host.hostname || host.username || host.password || host.port || host.pathname)
            throw new Error();
        return host.hostname.toLowerCase();
    } catch {
        throw new Error(
            "Invalid trusted SSH hostname. Use a hostname or a bracketed IPv6 address without userinfo, port, or path.",
        );
    }
}
