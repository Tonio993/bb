export type DescriptionTemplateValues = {
    title: string;
    sourceBranch: string;
    targetBranch: string;
    projectKey: string;
    repository: string;
    commits: string;
};

export function renderDescriptionTemplate(
    template: string,
    values: DescriptionTemplateValues,
): string {
    return template.replace(/{{([^{}]*)}}/g, (_match, rawName: string) => {
        const name = rawName.trim();
        if (!Object.hasOwn(values, name))
            throw new Error("Unknown Pull Request template placeholder: " + name + ".");
        return values[name as keyof DescriptionTemplateValues];
    });
}
