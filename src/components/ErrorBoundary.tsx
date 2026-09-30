// Límite de error: evita que un fallo de render (p. ej. una geometría 3D inválida)
// tumbe toda la app. Muestra un mensaje y un botón para reintentar.
import { Component, ErrorInfo, ReactNode } from "react";

interface Props { children: ReactNode; label?: string }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary:", error, info);
  }
  // Permite recuperarse cuando cambian los children (p. ej. otra pestaña/estado).
  componentDidUpdate(prev: Props) {
    if (prev.children !== this.props.children && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty" style={{ flexDirection: "column", gap: 8 }}>
          <div>⚠ No se pudo mostrar {this.props.label ?? "esta vista"}.</div>
          <button onClick={() => this.setState({ error: null })}>Reintentar</button>
        </div>
      );
    }
    return this.props.children;
  }
}
