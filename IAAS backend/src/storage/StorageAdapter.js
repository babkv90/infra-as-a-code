// Base interface for durable artifact storage (uploaded Lambda zips today; anything else a
// deployment needs to persist beyond its own ephemeral Terraform run in the future). This is
// deliberately NOT responsible for the Terraform CLI's own execution scratch space (main.tf,
// .terraform/, tfplan) — that always needs a real local/ephemeral directory to run `terraform` in,
// regardless of storage mode, since Terraform is a local process. getWorkingDirectory() reflects
// that: it returns a local path in every adapter.
export class StorageAdapter {
  /**
   * @param {string} key
   * @param {Buffer|string} content
   * @returns {Promise<void>}
   */
  async writeFile(key, content) {
    throw new Error('StorageAdapter.writeFile not implemented');
  }

  /**
   * @param {string} key
   * @returns {Promise<Buffer>}
   */
  async readFile(key) {
    throw new Error('StorageAdapter.readFile not implemented');
  }

  /**
   * @param {string} key
   * @returns {Promise<void>}
   */
  async deleteFile(key) {
    throw new Error('StorageAdapter.deleteFile not implemented');
  }

  /**
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    throw new Error('StorageAdapter.exists not implemented');
  }

  /**
   * Local scratch directory the Terraform CLI executes in for this deployment. Always a real path
   * on local disk, in every mode — see the class comment above.
   * @param {string} deploymentId
   * @returns {Promise<string>}
   */
  async getWorkingDirectory(deploymentId) {
    throw new Error('StorageAdapter.getWorkingDirectory not implemented');
  }

  /**
   * What Terraform needs to reference an artifact stored under `key`.
   * @param {string} key
   * @returns {{ type: 'local', filename: string } | { type: 's3', bucket: string, key: string }}
   */
  resolveArtifactReference(key) {
    throw new Error('StorageAdapter.resolveArtifactReference not implemented');
  }
}
