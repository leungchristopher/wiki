# Local Wiki

I like Obsidian, but it's distracting with its infinite variety of tools. Plus, I find it annoying that I have to have my browser open at the same time, and the constant tab switching means that it's easy to get sidetracked. With the side-by-side tab function, my side-by-side wiki has become useful. It gets rid of the bloatinherent in 

## Start

Requires Node.js 20 or newer.

```sh
npm ci
npm start
```

Open **http://127.0.0.1:3000**. 

The default wiki folder is `wiki-data/`. You can choose another folder when starting the app:

```sh
WIKI_DIR=/absolute/path/to/my-wiki npm start
```

Set `PORT` to use a different local port. The app creates the folder and a `Home.md` page if they do not exist.

## Write and navigate

Focus the command bar with `/`, or click it to see available commands.

| Command | Action |
| --- | --- |
| `edit` | Edit the current page |
| `save` / `cancel` | Leave the editor; Ctrl/Cmd+S also saves |
| `new Page Title` | Create a page |
| `open Page Title` | Open a matching page |
| `search geometry` | Search titles and content; bare `search` opens the search view |
| `related` | Show backlinks and outlinks |
| `graph` | Open the graph of all pages |
| `history` | View revisions and restore an earlier version |
| `rename New Title` | Rename the current page and update wiki links to it |
| `delete` / `trash` | Delete a page or recover deleted pages |

Use `[[Page Title]]` to link notes. A link to a missing page opens a draft with that title. Search tolerates typos; use the arrow keys and Enter to open a result.

Pages support Markdown, fenced code, tables, and TeX with `$...$` or `$$...$$`. Paste or drop an image into the editor to save it in `assets/`.
