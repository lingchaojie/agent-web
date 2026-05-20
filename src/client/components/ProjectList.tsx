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

  const activeProjects = filteredProjects.filter((project) => project.source === 'active-client');
  const scannedProjects = filteredProjects.filter((project) => project.source !== 'active-client');

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
      <ProjectGroup title="当前打开的 Claude Code 客户端" projects={activeProjects} selectedProjectId={selectedProjectId} onSelect={onSelect} />
      <ProjectGroup title="扫描 .claude 的工作区" projects={scannedProjects} selectedProjectId={selectedProjectId} onSelect={onSelect} />
    </section>
  );
}

function ProjectGroup({ title, projects, selectedProjectId, onSelect }: { title: string; projects: Project[]; selectedProjectId: string | null; onSelect(project: Project): void }) {
  if (projects.length === 0) return null;
  return (
    <section className="project-group" role="group" aria-label={title}>
      <h3>{title}</h3>
      <div className="stack-list">
        {projects.map((project) => <ProjectCard key={project.id} project={project} selected={project.id === selectedProjectId} onSelect={onSelect} />)}
      </div>
    </section>
  );
}

function ProjectCard({ project, selected, onSelect }: { project: Project; selected: boolean; onSelect(project: Project): void }) {
  return (
    <button
      className={`list-card project-card ${selected ? 'selected' : ''}`}
      type="button"
      onClick={() => onSelect(project)}
      disabled={!project.available}
    >
      <span className="list-card-main">
        <span className="row-title">
          {project.favorite ? '★ ' : ''}{project.name}
        </span>
        <span className="row-subtitle">{projectSourceLabel(project)} · {project.path}</span>
      </span>
      <span className={`status-chip ${project.available ? 'available' : 'offline'}`}>
        {project.available ? '可用' : '缺失'}
      </span>
    </button>
  );
}

function projectSourceLabel(project: Project): string {
  if (project.source === 'active-client') return '当前客户端';
  if (project.source === 'history') return '历史扫描';
  return '固定项目';
}
