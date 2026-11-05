export type ParsedBitbucketRemote = {
    protocol: "http" | "https" | "ssh";
    hostname: string;
    port: number | undefined;
    contextPath: string;
    projectKey: string;
    repository: string;
};
