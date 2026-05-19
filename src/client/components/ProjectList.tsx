import { useMemo, useState } from 'react';
import type { Project } from '../../shared/types';

type ProjectListProps = {
  projects: Project[];
  selectedProjectId: string | null;
  onSelect(project: Project): void;
};

export default function ProjectList({ projects, selectedProjectId, onSelect }: ProjectListProps) {
  const [query, setQuery] = useState('');
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) => `${project.name} ${project.path}`.toLowerCase().includes(normalized));
  }, [projects, query]);

  return (
    <section className="panel project-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">项目</p>
          <h2>工作区</h2>
        </div>
        <span className="count-pill">{projects.length}</span>
      </div>
      <input
        className="project-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索本机项目"
        aria-label="搜索项目"
      />
      <div className="stack-list">
        {filteredProjects.map((project) => (
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
              <span className="row-subtitle">{project.source === 'history' ? '历史项目' : '固定项目'} · {project.path}</span>
            </span>
            <span className={`status-chip ${project.available ? 'available' : 'offline'}`}>
              {project.available ? '可用' : '缺失'}
            </span>
          </button>
        ))}
        {filteredProjects.length === 0 ? <p className="empty-state">没有匹配项目。</p> : null}
      </div>
    </section>
  );
}
