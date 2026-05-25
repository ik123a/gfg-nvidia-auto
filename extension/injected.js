console.log("GFG AUTO: Injected script loaded");

window.addEventListener("message", (event) => {
  if (event.data.type === "GET_EDITOR_VALUE") {
    try {
      // 1. Try Monaco (Modern GFG)
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models && models.length > 0) {
          const value = models[0].getValue();
          window.postMessage({ type: "EDITOR_VALUE_RETURN", value }, "*");
          return;
        }
      }

      // 2. Try Ace (Legacy GFG)
      const editorElement = document.querySelector('.ace_editor');
      if (editorElement && typeof ace !== 'undefined') {
        const editor = ace.edit(editorElement);
        const value = editor.getValue();
        window.postMessage({ type: "EDITOR_VALUE_RETURN", value }, "*");
        return;
      }
      
      // Fallback
      window.postMessage({ type: "EDITOR_VALUE_RETURN", value: "" }, "*");
    } catch (e) {
      console.error("GFG AUTO Error getting editor value: ", e);
      window.postMessage({ type: "EDITOR_VALUE_RETURN", value: "" }, "*");
    }
  }

  if (event.data.type === "SET_EDITOR_VALUE") {
    try {
      // 1. Try Monaco (Modern GFG)
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models && models.length > 0) {
          models[0].setValue(event.data.value);
          console.log("GFG AUTO: Code injected into Monaco editor.");
          return;
        }
      }

      // 2. Try Ace (Legacy GFG)
      const editorElement = document.querySelector('.ace_editor');
      if (editorElement && typeof ace !== 'undefined') {
        const editor = ace.edit(editorElement);
        editor.setValue(event.data.value);
        console.log("GFG AUTO: Code injected into Ace editor.");
      }
    } catch (e) {
      console.error("GFG AUTO Error setting editor value: ", e);
    }
  }
});
