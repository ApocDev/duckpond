import { Component, createRef, type ReactNode } from "react";

type Anchor = { element: Element; top: number };

/** Capture the reading position before React grows any of the streaming replies. */
export class Transcript extends Component<{ children: ReactNode }> {
  private viewport = createRef<HTMLDivElement>();
  private following = true;
  private lastTop = 0;

  componentDidMount() {
    this.jumpToLatest();
  }

  getSnapshotBeforeUpdate(): Anchor[] {
    const viewport = this.viewport.current;
    if (!viewport || this.following) return [];
    const top = viewport.getBoundingClientRect().top;
    const message = Array.from(viewport.querySelectorAll("[data-scroll-anchor]")).find(
      (element) => element.getBoundingClientRect().bottom > top,
    );
    if (!message) return [];
    const paragraph = Array.from(message.querySelectorAll("p, li, pre, h1, h2, h3, summary")).find(
      (element) => element.getClientRects().length && element.getBoundingClientRect().bottom > top,
    );
    return (paragraph ? [paragraph, message] : [message]).map((element) => ({
      element,
      top: element.getBoundingClientRect().top,
    }));
  }

  componentDidUpdate(
    _props: Readonly<{ children: ReactNode }>,
    _state: unknown,
    anchors: Anchor[],
  ) {
    const viewport = this.viewport.current;
    if (!viewport) return;
    if (this.following) {
      viewport.scrollTop = viewport.scrollHeight;
    } else {
      const anchor = anchors.find(({ element }) => element.isConnected);
      if (anchor) viewport.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top;
    }
    this.lastTop = viewport.scrollTop;
  }

  private jumpToLatest = () => {
    const viewport = this.viewport.current;
    if (!viewport) return;
    this.following = true;
    viewport.scrollTop = viewport.scrollHeight;
    this.lastTop = viewport.scrollTop;
  };

  private onScroll = () => {
    const viewport = this.viewport.current;
    if (!viewport || viewport.scrollTop === this.lastTop) return;
    this.following =
      viewport.scrollTop >= this.lastTop &&
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 48;
    this.lastTop = viewport.scrollTop;
  };

  render() {
    return (
      <div className="transcript" ref={this.viewport} onScroll={this.onScroll}>
        {this.props.children}
      </div>
    );
  }
}
