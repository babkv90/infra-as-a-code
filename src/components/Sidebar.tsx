import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { awsServices, categories } from '../data/awsServices';
import { useDiagramStore } from '../store/diagramStore';
import type { AuthUser } from '../auth/authClient';
import { isServiceAllowedForUser, serviceAccessTierForUser } from '../utils/accessControl';

function Sidebar({ isCollapsed = false, onToggleCollapsed, user }: { isCollapsed?: boolean; onToggleCollapsed?: () => void; user?: AuthUser | null }) {
  const [query, setQuery] = useState('');
  const nodes = useDiagramStore((state) => state.nodes);
  const accessTier = serviceAccessTierForUser(user);

  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    nodes.forEach((node) => {
      if (node.data.serviceId) tally.set(node.data.serviceId, (tally.get(node.data.serviceId) ?? 0) + 1);
    });
    return tally;
  }, [nodes]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return awsServices.filter((service) => !normalized || `${service.name} ${service.category} ${service.shortName}`.toLowerCase().includes(normalized));
  }, [query]);

  if (isCollapsed) {
    return (
      <aside className="sidebar sidebar--collapsed">
        <button className="sidebar-toggle-button" onClick={onToggleCollapsed} title="Expand services panel" type="button">
          <PanelLeftOpen size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <span>AWS Services</span>
        <button className="sidebar-toggle-button" onClick={onToggleCollapsed} title="Collapse services panel" type="button">
          <PanelLeftClose size={17} />
        </button>
      </div>
      <div className="sidebar__search">
        <Search size={16} />
        <input placeholder="Search AWS services" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="service-groups">
        {categories.map((category) => {
          const services = filtered.filter((service) => service.category === category);
          if (!services.length) return null;
          return (
            <section key={category} className="service-group">
              <div className="service-group__title">{category}</div>
              {services.map((service) => {
                const isAllowed = isServiceAllowedForUser(service.id, user);
                return (
                  <div
                    key={service.id}
                    className={`service-item ${isAllowed ? '' : 'service-item--locked'}`}
                    draggable={isAllowed}
                    title={isAllowed ? service.name : `${service.name} is locked for ${accessTier}`}
                    onDragStart={(event) => {
                      if (!isAllowed) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.setData('application/aws-service', service.id);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                  >
                    <span className="service-item__icon" style={{ backgroundColor: service.color }} />
                    <span className="truncate">{service.name}</span>
                    {!isAllowed && <span className="service-item__lock">Locked</span>}
                    {!!counts.get(service.id) && <span className="service-item__badge">{counts.get(service.id)}</span>}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

export default Sidebar;
