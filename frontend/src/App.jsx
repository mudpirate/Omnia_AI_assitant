import { useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import Chat from "./chat";
import Text from "./Text";
function App() {
  const [count, setCount] = useState(0);

  return (
    <>
      <Text />
    </>
  );
}

export default App;
