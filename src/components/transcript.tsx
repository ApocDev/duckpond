import { ArrowDown } from "lucide-react";
import { Component, createRef, type ReactNode } from "react";
import type { Message } from "../lib/room";

type Anchor = { element: Element; top: number };
type TranscriptProps = { children: ReactNode; messages?: Message[] };

/** Changes when a message is added or grows, but not when the same messages are reloaded. */
const progress = (messages?: Message[]) =>
  messages?.map((message) => `${message.id}:${message.status}:${message.text.length}`).join();

/** The id of your latest message, so sending one can bring the view back down. */
const lastSent = (messages?: Message[]) => messages?.findLast((message) => !message.duckId)?.id;

/** Capture the reading position before React grows any of the streaming replies. */
export class Transcript extends Component<TranscriptProps, { unread: boolean }> {
  state = { unread: false };
  private viewport = createRef<HTMLDivElement>();
  private following = true;
  private lastTop = 0;

  componentDidMount() {
    this.jumpToLatest();
  }

  getSnapshotBeforeUpdate(previousProps: Readonly<TranscriptProps>): Anchor[] {
    if (previousProps.messages === this.props.messages) return [];
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
    previousProps: Readonly<TranscriptProps>,
    previousState: Readonly<{ unread: boolean }>,
    anchors: Anchor[],
  ) {
    // The unread button also changes the viewport height when it appears or disappears.
    if (
      previousProps.messages === this.props.messages &&
      previousState.unread === this.state.unread
    )
      return;
    const viewport = this.viewport.current;
    if (!viewport) return;
    if (lastSent(this.props.messages) !== lastSent(previousProps.messages)) {
      this.following = true;
      if (this.state.unread) this.setState({ unread: false });
    }
    if (this.following) {
      viewport.scrollTop = viewport.scrollHeight;
    } else {
      const anchor = anchors.find(({ element }) => element.isConnected);
      if (anchor) viewport.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top;
    }
    this.lastTop = viewport.scrollTop;
    // Already at the bottom after the update: nothing new is out of view, so keep following.
    if (!this.following && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 48)
      this.following = true;
    if (
      !this.following &&
      progress(previousProps.messages) !== progress(this.props.messages) &&
      !this.state.unread
    )
      this.setState({ unread: true });
  }

  private jumpToLatest = () => {
    const viewport = this.viewport.current;
    if (!viewport) return;
    this.following = true;
    viewport.scrollTop = viewport.scrollHeight;
    this.lastTop = viewport.scrollTop;
    if (this.state.unread) this.setState({ unread: false });
  };

  private onScroll = () => {
    const viewport = this.viewport.current;
    if (!viewport || viewport.scrollTop === this.lastTop) return;
    const fromBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    // Content shrinking (a round folding up) pulls scrollTop down while the view stays at the
    // bottom; only a move up away from the bottom means you scrolled to read.
    this.following = fromBottom <= 1 || (viewport.scrollTop >= this.lastTop && fromBottom < 48);
    this.lastTop = viewport.scrollTop;
    if (this.following && this.state.unread) this.setState({ unread: false });
  };

  render() {
    return (
      <>
        <div
          className="transcript"
          ref={this.viewport}
          onScroll={this.onScroll}
          onClickCapture={(event) => {
            const summary =
              event.target instanceof Element ? event.target.closest("summary") : null;
            if (summary?.parentElement instanceof HTMLDetailsElement && !summary.parentElement.open)
              this.following = false;
          }}
        >
          {this.props.children}
        </div>
        {this.state.unread && (
          <div className="transcript-jump">
            <button onClick={this.jumpToLatest}>
              <ArrowDown size={14} /> New replies
            </button>
          </div>
        )}
      </>
    );
  }
}
