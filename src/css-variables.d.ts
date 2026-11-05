import "react";

// Custom properties set from components; styles.css reads them.
declare module "react" {
  interface CSSProperties {
    "--duck"?: string;
  }
}
