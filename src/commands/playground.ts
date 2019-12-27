import { debounce } from "debounce";
import * as path from "path";
import * as pug from "pug";
import * as sass from "sass";
import * as typescript from "typescript";
import * as vscode from "vscode";
import * as config from "../config";
import { EXTENSION_ID, FS_SCHEME, PLAYGROUND_JSON_FILE } from "../constants";
import { IPlaygroundJSON } from "../interfaces/IPlaygroundJSON";
import { Gist } from "../store";
import { newGist } from "../store/actions";
import { closeGistFiles, fileNameToUri } from "../utils";
import { PlaygroundWebview } from "../webView";
import { addPlaygroundLibraryCommand } from "./addPlaygroundLibraryCommand";
import { getCDNJSLibraries } from "./cdnjs";

export enum PlaygroundLibraryType {
  script = "scripts",
  style = "styles"
}

const MarkupLanguage = {
  html: ".html",
  pug: ".pug"
};

const MARKUP_EXTENSIONS = [MarkupLanguage.html, MarkupLanguage.pug];

const StylesheetLanguage = {
  css: ".css",
  scss: ".scss"
};

export const DEFAULT_MANIFEST = {
  scripts: [] as string[],
  styles: [] as string[]
};

const STYLESHEET_EXTENSIONS = [StylesheetLanguage.css, StylesheetLanguage.scss];

const ScriptLanguage = {
  babel: ".babel",
  javascript: ".js",
  javascriptreact: ".jsx",
  typescript: ".ts",
  typescriptreact: ".tsx"
};
const REACT_EXTENSIONS = [
  ScriptLanguage.babel,
  ScriptLanguage.javascriptreact,
  ScriptLanguage.typescriptreact
];

const TYPESCRIPT_EXTENSIONS = [ScriptLanguage.typescript, ...REACT_EXTENSIONS];
const SCRIPT_EXTENSIONS = [ScriptLanguage.javascript, ...TYPESCRIPT_EXTENSIONS];

interface IPlayground {
  gistId: string;
  webView: PlaygroundWebview;
  webViewPanel: vscode.WebviewPanel;
  console: vscode.OutputChannel;
}

export let activePlayground: IPlayground | null;

export async function closeWebviewPanel(gistId: string) {
  if (activePlayground && activePlayground.gistId === gistId) {
    activePlayground.webViewPanel.dispose();
  }
}

const isReactFile = (fileName: string) => {
  return REACT_EXTENSIONS.includes(path.extname(fileName));
};

const REACT_SCRIPTS = ["react", "react-dom"];

const includesReactFiles = (gist: Gist) => {
  return Object.keys(gist.files).some(isReactFile);
};

const includesReactScripts = (scripts: string[]) => {
  return REACT_SCRIPTS.every((script) => scripts.includes(script));
};

const getManifestContent = (gist: Gist) => {
  if (!gist.files[PLAYGROUND_JSON_FILE]) {
    return "";
  }

  const manifest = gist.files[PLAYGROUND_JSON_FILE].content!;
  if (includesReactFiles(gist)) {
    const parsedManifest = JSON.parse(manifest);
    if (!includesReactScripts(parsedManifest.scripts)) {
      parsedManifest.scripts.push(...REACT_SCRIPTS);
      parsedManifest.scripts = [...new Set(parsedManifest.scripts)];

      const content = JSON.stringify(parsedManifest, null, 2);

      vscode.workspace.fs.writeFile(
        fileNameToUri(gist.id, PLAYGROUND_JSON_FILE),
        Buffer.from(content)
      );

      return content;
    }
  }

  return manifest;
};

async function generateNewPlaygroundFiles() {
  const scriptLanguage = await config.get("playground.scriptLanguage");
  const scriptFileName = `script${ScriptLanguage[scriptLanguage]}`;

  const manifest = {
    ...DEFAULT_MANIFEST
  };

  if (isReactFile(scriptFileName)) {
    manifest.scripts.push(...REACT_SCRIPTS);
  }

  const files = [
    {
      filename: scriptFileName
    },
    {
      filename: PLAYGROUND_JSON_FILE,
      content: JSON.stringify(manifest, null, 2)
    }
  ];

  if (await config.get("playground.includeStylesheet")) {
    const stylesheetLanguage = await config.get(
      "playground.stylesheetLanguage"
    );
    const stylesheetFileName = `style${StylesheetLanguage[stylesheetLanguage]}`;

    files.unshift({
      filename: stylesheetFileName
    });
  }

  if (await config.get("playground.includeMarkup")) {
    const markupLanguage = await config.get("playground.markupLanguage");
    const markupFileName = `index${MarkupLanguage[markupLanguage]}`;

    files.unshift({
      filename: markupFileName
    });
  }

  return files;
}

export function getScriptContent(
  document: vscode.TextDocument,
  manifest: IPlaygroundJSON | undefined
) {
  let content = document.getText();
  const extension = path.extname(document.uri.toString()).toLocaleLowerCase();

  const includesJsx = manifest && manifest.scripts.includes("react");
  if (TYPESCRIPT_EXTENSIONS.includes(extension) || includesJsx) {
    const compilerOptions: typescript.CompilerOptions = {
      experimentalDecorators: true
    };

    if (includesJsx || REACT_EXTENSIONS.includes(extension)) {
      compilerOptions.jsx = typescript.JsxEmit.React;
    }

    content = typescript.transpile(content, compilerOptions);
  }
  return content;
}

function getMarkupContent(document: vscode.TextDocument) {
  let content = document.getText();
  const extension = path.extname(document.uri.toString()).toLocaleLowerCase();

  if (extension === MarkupLanguage.pug) {
    content = pug.render(content);
  }

  return content;
}

async function getStylesheetContent(document: vscode.TextDocument) {
  let content = document.getText();
  const extension = path.extname(document.uri.toString()).toLocaleLowerCase();

  if (extension === StylesheetLanguage.scss) {
    content = sass.renderSync({ data: content }).css.toString();
  }

  return content;
}

function isPlaygroundManifestFile(gist: Gist, document: vscode.TextDocument) {
  if (gist.id !== document.uri.authority) {
    return false;
  }

  const fileName = path.basename(document.uri.toString().toLowerCase());
  return fileName === PLAYGROUND_JSON_FILE;
}

const EDITOR_LAYOUT = {
  oneByOne: {
    orientation: 0,
    groups: [{}, {}]
  },
  oneByTwo: {
    orientation: 0,
    groups: [
      { orientation: 1, groups: [{}, {}], size: 0.5 },
      { groups: [{}], size: 0.5 }
    ]
  },
  twoByTwo: {
    groups: [
      { groups: [{}, {}], size: 0.5 },
      { groups: [{}, {}], size: 0.5 }
    ]
  }
};

const getGistFileOfType = (gist: Gist, extensions: string[]) => {
  return Object.keys(gist.files).find((file) =>
    extensions.includes(path.extname(file))
  );
};

function isPlaygroundDocument(
  gist: Gist,
  document: vscode.TextDocument,
  extensions: string[]
) {
  if (gist.id !== document.uri.authority) {
    return false;
  }

  const extension = path.extname(document.uri.toString()).toLocaleLowerCase();
  return extensions.includes(extension);
}

export async function openPlayground(gist: Gist) {
  vscode.commands.executeCommand("setContext", "gistpad:inPlayground", true);

  const markupFile = getGistFileOfType(gist, MARKUP_EXTENSIONS);
  const stylesheetFile = getGistFileOfType(gist, STYLESHEET_EXTENSIONS);
  const scriptFile = getGistFileOfType(gist, SCRIPT_EXTENSIONS);

  const includedFiles = [!!markupFile, !!stylesheetFile, !!scriptFile].filter(
    (file) => file
  ).length;

  let editorLayout: any;
  if (includedFiles === 3) {
    editorLayout = EDITOR_LAYOUT.twoByTwo;
  } else if (includedFiles === 2) {
    editorLayout = EDITOR_LAYOUT.oneByTwo;
  } else {
    editorLayout = EDITOR_LAYOUT.oneByOne;
  }

  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await vscode.commands.executeCommand("vscode.setEditorLayout", editorLayout);

  const availableViewColumns = [
    vscode.ViewColumn.One,
    vscode.ViewColumn.Two,
    vscode.ViewColumn.Three,
    vscode.ViewColumn.Four
  ];

  let htmlEditor: vscode.TextEditor;
  if (markupFile) {
    htmlEditor = await vscode.window.showTextDocument(
      fileNameToUri(gist.id, markupFile),
      {
        preview: false,
        viewColumn: availableViewColumns.shift(),
        preserveFocus: true
      }
    );
  }

  let jsEditor: vscode.TextEditor | undefined;
  if (scriptFile) {
    jsEditor = await vscode.window.showTextDocument(
      fileNameToUri(gist.id, scriptFile!),
      {
        preview: false,
        viewColumn: availableViewColumns.shift(),
        preserveFocus: false
      }
    );
  }

  let cssEditor: vscode.TextEditor;
  if (stylesheetFile) {
    cssEditor = await vscode.window.showTextDocument(
      fileNameToUri(gist.id, stylesheetFile),
      {
        preview: false,
        viewColumn: availableViewColumns.shift(),
        preserveFocus: true
      }
    );
  }

  const webViewPanel = vscode.window.createWebviewPanel(
    "gistpad.playgroundPreview",
    "Preview",
    { viewColumn: availableViewColumns.shift()!, preserveFocus: true },
    { enableScripts: true }
  );

  const output = vscode.window.createOutputChannel("GistPad Playground");

  // In order to provide CodePen interop,
  // we'll look for an optional "scripts"
  // file, which includes the list of external
  // scripts that were added to the pen.
  let scripts: string | undefined;
  if (gist.files["scripts"]) {
    scripts = gist.files["scripts"].content;
  }
  let styles: string | undefined;
  if (gist.files["styles"]) {
    styles = gist.files["styles"].content;
  }

  const htmlView = new PlaygroundWebview(
    webViewPanel.webview,
    output,
    gist,
    scripts,
    styles
  );

  if (await config.get("playground.showConsole")) {
    output.show(false);
  }

  const autoRun = await config.get("playground.autoRun");
  const runOnEdit = autoRun === "onEdit";

  const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument(
    debounce(async ({ document }) => {
      if (isPlaygroundDocument(gist, document, MARKUP_EXTENSIONS)) {
        htmlView.updateHTML(getMarkupContent(document), runOnEdit);
      } else if (isPlaygroundDocument(gist, document, SCRIPT_EXTENSIONS)) {
        // If the user renamed the script file (e.g. from *.js to *.jsx)
        // than we need to update the manifest in case new scripts
        // need to be injected into the webview (e.g. "react").
        if (
          jsEditor &&
          jsEditor.document.uri.toString() !== document.uri.toString()
        ) {
          // TODO: Clean up this logic
          const oldFile =
            gist.files[path.basename(jsEditor.document.uri.toString())];
          if (oldFile) {
            gist.files[path.basename(document.uri.toString())] = oldFile;
            delete gist.files[path.basename(jsEditor.document.uri.toString())];

            htmlView.updateManifest(getManifestContent(gist), runOnEdit);
          }
        }
        htmlView.updateJavaScript(document, runOnEdit);
      } else if (isPlaygroundManifestFile(gist, document)) {
        htmlView.updateManifest(document.getText(), runOnEdit);

        if (jsEditor) {
          // TODO: Only update the JS if the manifest change
          // actually impacts it (e.g. adding/removing react)
          htmlView.updateJavaScript(jsEditor.document, runOnEdit);
        }
      } else if (isPlaygroundDocument(gist, document, STYLESHEET_EXTENSIONS)) {
        htmlView.updateCSS(await getStylesheetContent(document), runOnEdit);
      }
    }, 100)
  );

  let documentSaveDisposeable: vscode.Disposable;
  if (!runOnEdit && autoRun === "onSave") {
    documentSaveDisposeable = vscode.workspace.onDidSaveTextDocument(
      async (document) => {
        if (
          document.uri.scheme === FS_SCHEME &&
          document.uri.authority === activePlayground?.gistId
        ) {
          await htmlView.rebuildWebview();
        }
      }
    );
  }

  webViewPanel.onDidDispose(() => {
    documentChangeDisposable.dispose();

    if (documentSaveDisposeable) {
      documentSaveDisposeable.dispose();
    }

    activePlayground = null;

    closeGistFiles(gist);
    output.dispose();

    vscode.commands.executeCommand("workbench.action.closePanel");
    vscode.commands.executeCommand("setContext", "gistpad:inPlayground", false);
  });

  htmlView.updateManifest(getManifestContent(gist));
  htmlView.updateHTML(
    !!markupFile ? getMarkupContent(htmlEditor!.document) : ""
  );
  htmlView.updateCSS(
    !!stylesheetFile ? await getStylesheetContent(cssEditor!.document) : ""
  );

  if (jsEditor) {
    htmlView.updateJavaScript(jsEditor.document);
  }

  activePlayground = {
    gistId: gist.id,
    webView: htmlView,
    webViewPanel,
    console: output
  };

  await htmlView.rebuildWebview();
}

export async function registerPlaygroundCommands(
  context: vscode.ExtensionContext
) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_ID}.newPlayground`,
      async () => {
        const description = await vscode.window.showInputBox({
          prompt: "Enter the description of the playground"
        });

        if (!description) {
          return;
        }

        const gist: Gist = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Creating Playground..."
          },
          async () =>
            newGist(
              await generateNewPlaygroundFiles(),
              true,
              description,
              false
            )
        );

        openPlayground(gist);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_ID}.addPlaygroundScript`,
      addPlaygroundLibraryCommand.bind(null, PlaygroundLibraryType.script)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_ID}.addPlaygroundStylesheet`,
      addPlaygroundLibraryCommand.bind(null, PlaygroundLibraryType.style)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_ID}.openPlaygroundConsole`,
      () => {
        if (activePlayground) {
          activePlayground.console.show();
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_ID}.openPlaygroundDeveloperTools`,
      () => {
        vscode.commands.executeCommand(
          "workbench.action.webview.openDeveloperTools"
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_ID}.runPlayground`,
      async () => {
        if (activePlayground) {
          await activePlayground.webView.rebuildWebview();
        }
      }
    )
  );

  // Warm up the local CDNJS cache
  await getCDNJSLibraries();
}
