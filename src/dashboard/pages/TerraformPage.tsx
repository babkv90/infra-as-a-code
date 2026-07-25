import { Copy, Github, TerminalSquare } from 'lucide-react';
import { EmptyState, Panel } from '../components/DashPrimitives';
import { terraformCode, terraformFiles } from '../dashboardData';

export function TerraformPage() {
  return (
    <div className="dash-page">
      <div className="dash-inline-actions">
        <button className="dash-secondary-action">
          <Copy size={16} />
          Copy Code
        </button>
        <button className="dash-primary-action">
          <Github size={16} />
          Push to GitHub
        </button>
      </div>
      <div className="dash-two-col dash-two-col--wide" style={{ minHeight: 'calc(100vh - 180px)' }}>
        <Panel title="Generated files" action="Regenerate">
          <div className="dash-file-list">
            {terraformFiles.length ? (
              terraformFiles.map((file) => (
                <div className="dash-file-row" key={file.name}>
                  <Code2Icon />
                  <span>{file.name}</span>
                  <small>{file.lines} lines</small>
                  <em>{file.status}</em>
                </div>
              ))
            ) : (
              <EmptyState>No Terraform files generated yet.</EmptyState>
            )}
          </div>
        </Panel>
        <Panel title="Terraform preview" action="Export .zip">
          <pre className="dash-code-preview">{terraformCode}</pre>
        </Panel>
      </div>
    </div>
  );
}

function Code2Icon() {
  return <TerminalSquare size={16} />;
}
