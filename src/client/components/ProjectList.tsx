import type { Project } from '../../shared/types';

type ProjectListProps = {
  projects: Project[];
  selectedProjectId: string | null;
  onSelect(project: Project): void;
};

export default function ProjectList({ projects, selectedProjectId, onSelect }: ProjectListProps) {
  return (
    <section className="panel project-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Projects</p>
          <h2>Workspaces</h2>
        </div>
        <span className="count-pill">{projects.length}</span>
      </div>
      <div className="stack-list">
        {projects.map((project) => (
          <button
            key={project.id}
            className={`list-card project-card ${project.id === selectedProjectId ? 'selected' : ''}`}
            type="button"
            onClick={() => onSelect(project)}
            disabled={!project.available}
          >
            <span className="list-card-main">
              <span className="row-title">
                {project.favorite ? '★ ' : ''}{project.name}
              </span>
              <span className="row-subtitle">{project.path}</span>
            </span>
            <span className={`status-chip ${project.available ? 'available' : 'offline'}`}>
              {project.available ? 'available' : 'missing'}
            </span>
          </button>
        ))}
        {projects.length === 0 ? <p className="empty-state">No projects are registered yet.</p> : null}
      </div>
    </section>
  );
}
