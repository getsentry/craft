import { Artifact, Client as ZeusClient } from '@zeus-ci/sdk';

export class ZeusStore {
  public readonly client: ZeusClient;
  public readonly repoOwner: string;
  public readonly repoName: string;

  public constructor(repoOwner: string, repoName: string) {
    this.client = new ZeusClient();
    this.repoOwner = repoOwner;
    this.repoName = repoName;
  }

  public async downloadArtifact(artifact: Artifact): Promise<string> {
    return this.client.downloadArtifact(artifact);
  }

  public async downloadArtifacts(artifacts: Artifact[]): Promise<string[]> {
    return this.client.downloadArtifacts(artifacts);
  }

  public async listArtifactsForRevision(sha: string): Promise<Artifact[]> {
    return this.client.listArtifactsForRevision(
      this.repoOwner,
      this.repoName,
      sha
    );
  }

  public async downloadAllForRevision(sha: string): Promise<string[]> {
    return this.client.downloadAllForRevision(
      this.repoOwner,
      this.repoName,
      sha
    );
  }
}
