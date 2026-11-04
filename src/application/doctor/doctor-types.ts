export type DoctorStatus = "OK" | "WARN" | "FAIL" | "SKIP";

export type DoctorCheck = {
    name: string;
    status: DoctorStatus;
    message: string;
};

export type DoctorOptions = { checkToken?: boolean; remote?: boolean };

export type LocalDiagnosis = { checks: DoctorCheck[]; serverUrl?: string };
export type CredentialDiagnosis = { checks: DoctorCheck[]; readyForRemote: boolean };
