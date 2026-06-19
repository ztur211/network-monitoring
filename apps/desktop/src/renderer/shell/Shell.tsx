import { useBootstrap } from '../data/use-bootstrap';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { ViewportHost } from './ViewportHost';

export function Shell() {
  useBootstrap();
  return (
    <div>
      <TopBar />
      <div style={{ display: 'flex', flex: 1 }}>
        <Sidebar />
        <ViewportHost />
      </div>
    </div>
  );
}
