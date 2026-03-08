@echo off
setlocal enabledelayedexpansion

rem ── Config ──────────────────────────────────────────────
set "MARKER_FILE=.ceauto-installed"
set "CEAUTO_DIR=%~dp0"
if "!CEAUTO_DIR:~-1!"=="\" set "CEAUTO_DIR=!CEAUTO_DIR:~0,-1!"
set "SERVER_NAME=ceauto"

rem ── Defaults ────────────────────────────────────────────
set "FORCE=false"
set "UNINSTALL=false"
set "UPDATE=false"
set "CLIENT=claudedesktop"
set "SKIP_TEST=false"
set "GLOBAL_CONFIG=false"
set "CLIENT_EXPLICIT=false"
set "STATUS=false"

goto :parse_args

rem ════════════════════════════════════════════════════════
:show_help
echo Usage: install.bat [options]
echo.
echo Options:
echo   -c, --client TYPE   MCP client: claudedesktop, claude, cursor, windsurf,
echo                       vscode, gemini, codex, zed, kilo, opencode, goose,
echo                       pidev, all  (default: claudedesktop)
echo   -f, --force         Skip prompts, overwrite existing config
echo   -u, --uninstall     Remove CEAuto from MCP client config
echo       --upgrade       Upgrade npm deps and reconfigure
echo       --update        Alias for --upgrade
echo       --status        Show where this server is currently installed
echo       --global        Write to global config path (claude, cursor, gemini,
echo                       codex, opencode, all)
echo       --skip-test     Skip server validation
echo   -h, --help          Show this help
echo.
echo Examples:
echo   install.bat                        Install for Claude Desktop
echo   install.bat -c claude              Install for Claude Code (workspace)
echo   install.bat -c claude --global     Install for Claude Code (global)
echo   install.bat -c cursor              Install for Cursor (workspace)
echo   install.bat -c cursor --global     Install for Cursor (global)
echo   install.bat -c windsurf            Install for Windsurf
echo   install.bat -c vscode              Install for VS Code (workspace)
echo   install.bat -c gemini              Install for Gemini CLI (workspace)
echo   install.bat -c codex               Install for OpenAI Codex CLI
echo   install.bat -c zed                 Install for Zed (global)
echo   install.bat -c kilo                Install for Kilo Code
echo   install.bat -c opencode            Install for OpenCode (workspace)
echo   install.bat -c opencode --global   Install for OpenCode (global)
echo   install.bat -c goose               Install for Goose
echo   install.bat -c all                 Install for all detected clients
echo   install.bat --status               Show installation status
echo   install.bat --upgrade              Upgrade npm deps
echo   install.bat --upgrade -c all        Upgrade + reconfigure all clients
echo   install.bat -u                     Uninstall
echo   install.bat -u -c all              Uninstall from all client configs
exit /b 0

rem ════════════════════════════════════════════════════════
:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="-h"          goto :show_help
if /i "%~1"=="--help"      goto :show_help
if /i "%~1"=="-f"          goto :pf_force
if /i "%~1"=="--force"     goto :pf_force
if /i "%~1"=="-u"          goto :pf_uninstall
if /i "%~1"=="--uninstall" goto :pf_uninstall
if /i "%~1"=="--update"    goto :pf_update
if /i "%~1"=="--upgrade"   goto :pf_update
if /i "%~1"=="--status"    goto :pf_status
if /i "%~1"=="--global"    goto :pf_global
if /i "%~1"=="--skip-test" goto :pf_skip_test
if /i "%~1"=="-c"          goto :pf_client
if /i "%~1"=="--client"    goto :pf_client
echo Unknown option: %~1
goto :show_help

:pf_force
set "FORCE=true"
shift
goto :parse_args
:pf_uninstall
set "UNINSTALL=true"
shift
goto :parse_args
:pf_update
set "UPDATE=true"
shift
goto :parse_args
:pf_status
set "STATUS=true"
shift
goto :parse_args
:pf_global
set "GLOBAL_CONFIG=true"
shift
goto :parse_args
:pf_skip_test
set "SKIP_TEST=true"
shift
goto :parse_args
:pf_client
if "%~2"=="" (
    echo   ERROR: --client requires a value >&2
    exit /b 1
)
set "CLIENT=%~2"
set "CLIENT_EXPLICIT=true"
shift
shift
goto :parse_args

:args_done

rem ── Default uninstall to all clients ─────────────────
if "!UNINSTALL!"=="true" (
    if "!CLIENT_EXPLICIT!"=="false" set "CLIENT=all"
)

rem ── Validate --global ─────────────────────────────────
if "!GLOBAL_CONFIG!"=="true" (
    if not "!CLIENT!"=="claude" (
        if not "!CLIENT!"=="cursor" (
            if not "!CLIENT!"=="gemini" (
                if not "!CLIENT!"=="codex" (
                    if not "!CLIENT!"=="both" (
                        if not "!CLIENT!"=="opencode" (
                            if not "!CLIENT!"=="all" (
                                echo   ERROR: --global is only valid with -c claude, cursor, gemini, codex, opencode, both, or all >&2
                                exit /b 1
                            )
                        )
                    )
                )
            )
        )
    )
)

rem ── Read version from package.json ───────────────────────
set "VERSION=unknown"
set "_CEA_FWD=!CEAUTO_DIR:\=/!"
for /f "usebackq delims=" %%V in (`node -e "try{process.stdout.write(require('!_CEA_FWD!/package.json').version);}catch(e){process.stdout.write('unknown');}" 2^>nul`) do set "VERSION=%%V"

rem ── Read installed version ───────────────────────────────
set "INSTALLED_VERSION="
if exist "!CEAUTO_DIR!\!MARKER_FILE!" (
    set /p INSTALLED_VERSION=<"!CEAUTO_DIR!\!MARKER_FILE!"
)

rem ── Compute config paths ─────────────────────────────────
set "DESKTOP_CONFIG=!APPDATA!\Claude\claude_desktop_config.json"
set "_PARENT=%CD%"

if "!GLOBAL_CONFIG!"=="true" (
    set "CODE_CONFIG=!USERPROFILE!\.claude.json"
) else (
    set "CODE_CONFIG=!_PARENT!\.mcp.json"
)

if "!GLOBAL_CONFIG!"=="true" (
    set "CURSOR_CONFIG=!USERPROFILE!\.cursor\mcp.json"
) else (
    set "CURSOR_CONFIG=!_PARENT!\.cursor\mcp.json"
)

set "WINDSURF_CONFIG=!USERPROFILE!\.codeium\windsurf\mcp_config.json"
set "VSCODE_CONFIG=!_PARENT!\.vscode\mcp.json"

if "!GLOBAL_CONFIG!"=="true" (
    set "GEMINI_CONFIG=!USERPROFILE!\.gemini\settings.json"
) else (
    set "GEMINI_CONFIG=!_PARENT!\.gemini\settings.json"
)

if "!GLOBAL_CONFIG!"=="true" (
    set "CODEX_CONFIG=!USERPROFILE!\.codex\config.toml"
) else (
    set "CODEX_CONFIG=!_PARENT!\.codex\config.toml"
)

set "ZED_CONFIG=!USERPROFILE!\.config\zed\settings.json"
set "KILO_CONFIG=!_PARENT!\.kilocode\mcp.json"

if "!GLOBAL_CONFIG!"=="true" (
    set "OPENCODE_CONFIG=!USERPROFILE!\.config\opencode\opencode.json"
) else (
    set "OPENCODE_CONFIG=!_PARENT!\opencode.json"
)

set "GOOSE_CONFIG=!USERPROFILE!\.config\goose\config.yaml"
set "SERVER_JS=!CEAUTO_DIR!\server.js"

rem ── Write Node.js helper scripts to temp ─────────────────
set "JS_MERGE=!TEMP!\ceauto_merge.js"
set "JS_REMOVE=!TEMP!\ceauto_remove.js"
set "JS_CHECK=!TEMP!\ceauto_check.js"
set "JS_MERGE_OC=!TEMP!\ceauto_merge_oc.js"
set "JS_REMOVE_OC=!TEMP!\ceauto_remove_oc.js"
set "JS_MERGE_GOOSE=!TEMP!\ceauto_merge_goose.js"
set "JS_REMOVE_GOOSE=!TEMP!\ceauto_remove_goose.js"
set "JS_MERGE_VSCODE=!TEMP!\ceauto_merge_vscode.js"
set "JS_REMOVE_VSCODE=!TEMP!\ceauto_remove_vscode.js"
set "JS_MERGE_CODEX=!TEMP!\ceauto_merge_codex.js"
set "JS_REMOVE_CODEX=!TEMP!\ceauto_remove_codex.js"
set "JS_MERGE_ZED=!TEMP!\ceauto_merge_zed.js"
set "JS_REMOVE_ZED=!TEMP!\ceauto_remove_zed.js"
set "JS_STATUS=!TEMP!\ceauto_status.js"

rem -- MERGE standard (mcpServers, command: node) --
(
echo const fs = require('fs'), path = require('path');
echo const [,, cfgPath, srvPath] = process.argv;
echo let c = {}; try { c = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch(e) {}
echo c.mcpServers = c.mcpServers ^|^| {};
echo c.mcpServers.ceauto = { command: 'node', args: [srvPath] };
echo fs.mkdirSync(path.dirname(path.resolve(cfgPath)),{recursive:true});
echo fs.writeFileSync(cfgPath, JSON.stringify(c,null,2)+'\n');
) > "!JS_MERGE!"

rem -- REMOVE standard --
(
echo const fs = require('fs');
echo const cfgPath = process.argv[2];
echo if (fs.existsSync(cfgPath) === false) process.exit(0);
echo let c = {}; try { c = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch(e) { process.exit(0); }
echo const s = c.mcpServers ^|^| {};
echo const lbl = process.argv[3] ^|^| 'config';
echo if ('ceauto' in s) { delete s.ceauto; fs.writeFileSync(cfgPath,JSON.stringify(c,null,2)+'\n'); console.log('  OK: Removed from ' + lbl); }
) > "!JS_REMOVE!"

rem -- CHECK (path match) --
(
echo const fs = require('fs');
echo const [,,cfgPath,srvPath] = process.argv;
echo try {
echo   const c = JSON.parse(fs.readFileSync(cfgPath,'utf8'));
echo   const e = (c.mcpServers^|^|{}).ceauto^|^|{};
echo   const args = e.args^|^|[];
echo   if (args.includes(srvPath)) console.log('uptodate');
echo   else if (args.length) console.log('changed');
echo   else console.log('missing');
echo } catch(ex) { console.log('missing'); }
) > "!JS_CHECK!"

rem -- MERGE opencode --
(
echo const fs = require('fs'), path = require('path');
echo const [,,cfgPath,srvPath] = process.argv;
echo let c = {}; try { c = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch(e) {}
echo c.mcp = c.mcp ^|^| {};
echo c.mcp.ceauto = { type: 'local', command: ['node', srvPath] };
echo fs.mkdirSync(path.dirname(path.resolve(cfgPath)),{recursive:true});
echo fs.writeFileSync(cfgPath, JSON.stringify(c,null,2)+'\n');
) > "!JS_MERGE_OC!"

rem -- REMOVE opencode --
(
echo const fs = require('fs');
echo const cfgPath = process.argv[2];
echo if (fs.existsSync(cfgPath) === false) process.exit(0);
echo let c = {}; try { c = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch(e) { process.exit(0); }
echo const m = c.mcp^|^|{};
echo if ('ceauto' in m) { delete m.ceauto; fs.writeFileSync(cfgPath,JSON.stringify(c,null,2)+'\n'); console.log('  OK: Removed from OpenCode'); }
) > "!JS_REMOVE_OC!"

rem -- MERGE goose --
(
echo const fs = require('fs'), path = require('path');
echo const [,,cfgPath,srvPath] = process.argv;
echo let yaml; try { yaml = require('!CEAUTO_DIR!\node_modules\js-yaml'); } catch(e) {
echo   console.log('  js-yaml unavailable. Add manually to Goose config.');
echo   process.exit(0);
echo }
echo let c = {}; try { c = yaml.load(fs.readFileSync(cfgPath,'utf8'))^|^|{}; } catch(e) {}
echo c.extensions = c.extensions^|^|{};
echo c.extensions.ceauto = {name:'ceauto',type:'stdio',cmd:'node',args:[srvPath],enabled:true};
echo fs.mkdirSync(path.dirname(path.resolve(cfgPath)),{recursive:true});
echo fs.writeFileSync(cfgPath, yaml.dump(c,{lineWidth:-1}));
) > "!JS_MERGE_GOOSE!"

rem -- REMOVE goose --
(
echo const fs = require('fs');
echo const cfgPath = process.argv[2];
echo let yaml; try { yaml = require('!CEAUTO_DIR!\node_modules\js-yaml'); } catch(e) { console.log('  js-yaml unavailable'); process.exit(0); }
echo if (fs.existsSync(cfgPath) === false) process.exit(0);
echo let c = {}; try { c = yaml.load(fs.readFileSync(cfgPath,'utf8'))^|^|{}; } catch(e) { process.exit(0); }
echo const e = c.extensions^|^|{};
echo if ('ceauto' in e) { delete e.ceauto; fs.writeFileSync(cfgPath,yaml.dump(c,{lineWidth:-1})); console.log('  OK: Removed from Goose'); }
) > "!JS_REMOVE_GOOSE!"

rem -- MERGE vscode (servers key) --
(
echo const fs = require('fs'), path = require('path');
echo const [,, cfgPath, srvPath] = process.argv;
echo let c = {}; try { c = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch(e) {}
echo c.servers = c.servers ^|^| {};
echo c.servers.ceauto = { type: 'stdio', command: 'node', args: [srvPath] };
echo fs.mkdirSync(path.dirname(path.resolve(cfgPath)),{recursive:true});
echo fs.writeFileSync(cfgPath, JSON.stringify(c,null,2)+'\n');
) > "!JS_MERGE_VSCODE!"

rem -- REMOVE vscode --
(
echo const fs = require('fs');
echo const cfgPath = process.argv[2];
echo if (fs.existsSync(cfgPath) === false) process.exit(0);
echo let c = {}; try { c = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch(e) { process.exit(0); }
echo const s = c.servers ^|^| {};
echo if ('ceauto' in s) { delete s.ceauto; fs.writeFileSync(cfgPath,JSON.stringify(c,null,2)+'\n'); console.log('  OK: Removed from VS Code'); }
) > "!JS_REMOVE_VSCODE!"

rem -- MERGE codex (TOML) --
(
echo const fs = require('fs'), path = require('path');
echo const cfgPath = process.argv[2];
echo const srvPath = process.argv[3];
echo const sn = 'ceauto';
echo const hdr = '[mcp_servers.' + sn + ']';
echo const cmd = 'node ' + srvPath;
echo const newSec = '\n' + hdr + '\ncommand = ' + JSON.stringify(cmd) + '\nstartup_timeout_sec = 30\ntool_timeout_sec = 300\nenabled = true\n';
echo const d = path.dirname(path.resolve(cfgPath));
echo if (d) fs.mkdirSync(d, {recursive:true});
echo let ex = '';
echo try { ex = fs.readFileSync(cfgPath,'utf8'); } catch(e) {}
echo if (ex.includes(hdr)) {
echo     const ln = ex.split('\n');
echo     let st = -1;
echo     for (const [i, l] of ln.entries()) { if (l.trim() === hdr) { st = i; break; } }
echo     if (st > -1) {
echo         const rest = ln.slice(st + 1);
echo         const relEnd = rest.findIndex(function(l){return l.charAt(0)==='[';});
echo         const en = relEnd === -1 ? ln.length : st + 1 + relEnd;
echo         ln.splice(st, en - st);
echo         ex = ln.join('\n');
echo     }
echo }
echo ex = ex.trimEnd();
echo if (ex) ex = ex + '\n';
echo fs.writeFileSync(cfgPath, ex + newSec);
) > "!JS_MERGE_CODEX!"

rem -- REMOVE codex --
(
echo const fs = require('fs');
echo const cfgPath = process.argv[2];
echo const sn = 'ceauto';
echo const hdr = '[mcp_servers.' + sn + ']';
echo if (fs.existsSync(cfgPath) === false) process.exit(0);
echo let ex = fs.readFileSync(cfgPath,'utf8');
echo if (ex.includes(hdr) === false) { process.exit(0); }
echo const ln = ex.split('\n');
echo let st = -1;
echo for (const [i, l] of ln.entries()) { if (l.trim() === hdr) { st = i; break; } }
echo if (st > -1) {
echo     const rest = ln.slice(st + 1);
echo     const relEnd = rest.findIndex(function(l){return l.charAt(0)==='[';});
echo     const en = relEnd === -1 ? ln.length : st + 1 + relEnd;
echo     ln.splice(st, en - st);
echo     fs.writeFileSync(cfgPath, ln.join('\n'));
echo     console.log('  Removed ceauto from codex config');
echo }
) > "!JS_REMOVE_CODEX!"

rem -- MERGE zed (context_servers) --
(
echo const fs = require('fs'), path = require('path');
echo const [,, cfgPath, srvPath] = process.argv;
echo let c = {}; try { c = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch(e) {}
echo c.context_servers = c.context_servers ^|^| {};
echo c.context_servers.ceauto = { command: { path: 'node', args: [srvPath], env: {} } };
echo fs.mkdirSync(path.dirname(path.resolve(cfgPath)),{recursive:true});
echo fs.writeFileSync(cfgPath, JSON.stringify(c,null,2)+'\n');
) > "!JS_MERGE_ZED!"

rem -- REMOVE zed --
(
echo const fs = require('fs');
echo const cfgPath = process.argv[2];
echo if (fs.existsSync(cfgPath) === false) process.exit(0);
echo let c = {}; try { c = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch(e) { process.exit(0); }
echo const cs = c.context_servers ^|^| {};
echo if ('ceauto' in cs) { delete cs.ceauto; fs.writeFileSync(cfgPath,JSON.stringify(c,null,2)+'\n'); console.log('  Removed ceauto from Zed config'); }
) > "!JS_REMOVE_ZED!"

rem -- STATUS check --
(
echo const fs = require('fs');
echo const cfgPath = process.argv[2];
echo const fmt = process.argv[3];
echo if (fs.existsSync(cfgPath) === false) { console.log('NO'); process.exit(0); }
echo try {
echo     if (fmt === 'toml') {
echo         const c = fs.readFileSync(cfgPath,'utf8');
echo         console.log(c.includes('[mcp_servers.ceauto]') ? 'YES' : 'NO');
echo     } else if (fmt === 'yaml') {
echo         const c = fs.readFileSync(cfgPath,'utf8');
echo         console.log(c.includes('  ceauto:') ? 'YES' : 'NO');
echo     } else {
echo         const c = JSON.parse(fs.readFileSync(cfgPath,'utf8'));
echo         console.log(JSON.stringify(c).includes('"ceauto"') ? 'YES' : 'NO');
echo     }
echo } catch(e) { console.log('NO'); }
) > "!JS_STATUS!"

rem ── Banner ───────────────────────────────────────────────
echo.
echo   CEAuto v!VERSION!
if "!STATUS!"=="true" (
    echo   Mode: status
) else if "!UNINSTALL!"=="true" (
    echo   Mode: uninstall
) else if "!UPDATE!"=="true" (
    echo   Mode: update
) else (
    echo   Mode: install ^(client: !CLIENT!^)
)
echo   -----------------------------
echo.

rem ── Status ───────────────────────────────────────────────
if "!STATUS!"=="true" (
    call :show_status
    goto :cleanup
)

rem ── Uninstall ────────────────────────────────────────────
if not "!UNINSTALL!"=="true" goto :not_uninstall

call :configure_client "!CLIENT!" ""

del /f /q "!CEAUTO_DIR!\!MARKER_FILE!" 2>nul
echo   Removed version marker
echo.
echo   CEAuto uninstalled.
echo.
goto :cleanup

:not_uninstall

rem ── Update/Upgrade ────────────────────────────────────────
if not "!UPDATE!"=="true" goto :not_update

if not "!INSTALLED_VERSION!"=="" (
    if "!INSTALLED_VERSION!"=="!VERSION!" (
        if not "!CLIENT_EXPLICIT!"=="true" (
            if not "!FORCE!"=="true" (
                echo   Already at v!VERSION!. Nothing to do.
                echo   Use --upgrade -c claude^|all to also reconfigure MCP client.
                echo.
                goto :cleanup
            )
        )
        echo   Already at v!VERSION! -- reconfiguring MCP client
    ) else (
        echo   Upgrading v!INSTALLED_VERSION! --^> v!VERSION!
    )
) else (
    echo   No marker found -- running full update
)
echo.


echo   Upgrading npm dependencies...
pushd "!CEAUTO_DIR!" && npm install --silent && popd
echo   OK: Dependencies upgraded
echo.

if "!CLIENT_EXPLICIT!"=="true" (
    echo   Reconfiguring MCP client ^(!CLIENT!^)...
    call :configure_client "!CLIENT!" "!SERVER_JS!"
    echo.
)

if not "!SKIP_TEST!"=="true" (
    echo   Validating server...
    node --check "!SERVER_JS!" >nul 2>&1
    if !errorlevel! equ 0 (
        echo   OK: Server validation passed
    ) else (
        echo   ERROR: Validation failed. Run 'node --check server.js' for details. >&2
    )
    echo.
)

echo !VERSION!> "!CEAUTO_DIR!\!MARKER_FILE!"
echo   OK: Marker updated to v!VERSION!
echo   -----------------------------
echo   CEAuto updated to v!VERSION!!
echo.
echo   Restart Claude (quit fully, then reopen) to load changes.
echo.
goto :cleanup

:not_update

rem ── Install ───────────────────────────────────────────────

if not "!INSTALLED_VERSION!"=="" (
    if "!INSTALLED_VERSION!"=="!VERSION!" (
        if not "!FORCE!"=="true" (
            echo   Already at v!VERSION!. Nothing to do.
            echo   Use --upgrade to upgrade dependencies, or -f to force reinstall.
            echo.
            goto :cleanup
        )
    )
)

rem 1. Check Node.js
echo   Checking Node.js...
node --version >nul 2>&1
if !errorlevel! neq 0 (
    echo   ERROR: Node.js is required. Install from https://nodejs.org >&2
    exit /b 1
)
for /f "usebackq delims=" %%V in (`node -e "console.log(process.version)" 2^>nul`) do set "NODE_VER=%%V"
for /f "usebackq delims=." %%M in (`node -e "console.log(process.versions.node.split('.')[0])" 2^>nul`) do set "NODE_MAJOR=%%M"
if !NODE_MAJOR! lss 18 (
    echo   ERROR: Node.js 18+ is required. Current: !NODE_VER! >&2
    exit /b 1
)
echo   OK: Node.js !NODE_VER!
echo.

rem 2. Install deps
echo   Installing dependencies...
pushd "!CEAUTO_DIR!" && npm install --silent && popd
echo   OK: Dependencies installed
echo.

rem 3. Validate server
if not "!SKIP_TEST!"=="true" (
    echo   Validating server...
    node --check "!SERVER_JS!" >nul 2>&1
    if !errorlevel! equ 0 (
        echo   OK: Server validation passed
    ) else (
        echo   ERROR: Validation failed. Run 'node --check server.js' for details. >&2
        echo   ERROR: Use --skip-test to skip this step. >&2
        goto :cleanup
    )
    echo.
)

rem 4. Configure MCP client
echo   Configuring MCP client...
call :configure_client "!CLIENT!" "!SERVER_JS!"
echo.

rem 5. Write marker
echo !VERSION!> "!CEAUTO_DIR!\!MARKER_FILE!"

rem ── Done ─────────────────────────────────────────────────
echo   -----------------------------
echo   CEAuto installed successfully!
echo.
echo   Next steps:
if "!CLIENT!"=="claude" (
    echo   1. Open the workspace in Claude Code
    echo   2. Fill in memory\context.md and strategy\goals.md
    echo   3. Call ceo_boot to start
) else if "!CLIENT!"=="claudedesktop" (
    echo   1. Restart Claude Desktop ^(quit fully, then reopen^)
    echo   2. Fill in memory\context.md and strategy\goals.md
    echo   3. Call ceo_boot to start
) else (
    echo   1. Restart your MCP client to load the server
    echo   2. Fill in memory\context.md and strategy\goals.md
    echo   3. Call ceo_boot to start
)
echo.

:cleanup
del /f /q "!JS_MERGE!" "!JS_REMOVE!" "!JS_CHECK!" 2>nul
del /f /q "!JS_MERGE_OC!" "!JS_REMOVE_OC!" 2>nul
del /f /q "!JS_MERGE_GOOSE!" "!JS_REMOVE_GOOSE!" 2>nul
del /f /q "!JS_MERGE_VSCODE!" "!JS_REMOVE_VSCODE!" 2>nul
del /f /q "!JS_MERGE_CODEX!" "!JS_REMOVE_CODEX!" 2>nul
del /f /q "!JS_MERGE_ZED!" "!JS_REMOVE_ZED!" 2>nul
del /f /q "!JS_STATUS!" 2>nul
endlocal
exit /b 0

rem ════════════════════════════════════════════════════════
rem Subroutine: show_status
:show_status
echo.
echo   CEAuto v!VERSION! -- Status
echo   ------------------------------------------------------------------------
echo   Client               Installed  Config path
echo   ------------------------------------------------------------------------
echo const fs=require('fs'); > "!JS_STATUS!"
echo function chk(p,fmt){if(fs.existsSync(p)===false)return false;try{const raw=fs.readFileSync(p,'utf8');if(fmt==='toml')return raw.includes('[mcp_servers.ceauto]');if(fmt==='yaml')return raw.includes('  ceauto:');return JSON.stringify(JSON.parse(raw)).includes('"ceauto"');}catch(e){return false;}} >> "!JS_STATUS!"
echo const rows=[ >> "!JS_STATUS!"
echo ['claudedesktop        ',String.raw`!DESKTOP_CONFIG!`,'json'], >> "!JS_STATUS!"
echo ['claude (workspace)   ',String.raw`!CODE_CONFIG!`,'json'], >> "!JS_STATUS!"
echo ['claude (global)      ',String.raw`!USERPROFILE!\.claude.json`,'json'], >> "!JS_STATUS!"
echo ['claude (global alt)  ',String.raw`!USERPROFILE!\.claude\mcp.json`,'json'], >> "!JS_STATUS!"
echo ['cursor (workspace)   ',String.raw`!_PARENT!\.cursor\mcp.json`,'json'], >> "!JS_STATUS!"
echo ['cursor (global)      ',String.raw`!USERPROFILE!\.cursor\mcp.json`,'json'], >> "!JS_STATUS!"
echo ['windsurf             ',String.raw`!WINDSURF_CONFIG!`,'json'], >> "!JS_STATUS!"
echo ['vscode (workspace)   ',String.raw`!VSCODE_CONFIG!`,'json'], >> "!JS_STATUS!"
echo ['gemini (workspace)   ',String.raw`!_PARENT!\.gemini\settings.json`,'json'], >> "!JS_STATUS!"
echo ['gemini (global)      ',String.raw`!USERPROFILE!\.gemini\settings.json`,'json'], >> "!JS_STATUS!"
echo ['codex (workspace)    ',String.raw`!_PARENT!\.codex\config.toml`,'toml'], >> "!JS_STATUS!"
echo ['codex (global)       ',String.raw`!USERPROFILE!\.codex\config.toml`,'toml'], >> "!JS_STATUS!"
echo ['zed                  ',String.raw`!ZED_CONFIG!`,'json'], >> "!JS_STATUS!"
echo ['kilo                 ',String.raw`!KILO_CONFIG!`,'json'], >> "!JS_STATUS!"
echo ['opencode (workspace) ',String.raw`!_PARENT!\opencode.json`,'json'], >> "!JS_STATUS!"
echo ['opencode (global)    ',String.raw`!USERPROFILE!\.config\opencode\opencode.json`,'json'], >> "!JS_STATUS!"
echo ['goose                ',String.raw`!GOOSE_CONFIG!`,'yaml'], >> "!JS_STATUS!"
echo ]; >> "!JS_STATUS!"
echo for(const[lbl,p,fmt]of rows){const r=chk(p,fmt);if(r)console.log('   '+lbl+'  YES  '+p);else console.log('   '+lbl+'  NO');} >> "!JS_STATUS!"
node "!JS_STATUS!"
echo   ------------------------------------------------------------------------
if not "!INSTALLED_VERSION!"=="" (
    echo   Package: v!INSTALLED_VERSION! installed
) else (
    echo   Package: not installed
)
echo.
goto :eof

rem ════════════════════════════════════════════════════════
rem Subroutine: configure_client <client_type> <server_js>
:configure_client
set "_ct=%~1"
set "_sj=%~2"

if "!_ct!"=="claudedesktop"  goto :cc_desktop
if "!_ct!"=="claude"         goto :cc_code
if "!_ct!"=="cursor"   goto :cc_cursor
if "!_ct!"=="windsurf" goto :cc_windsurf
if "!_ct!"=="vscode"   goto :cc_vscode
if "!_ct!"=="gemini"   goto :cc_gemini
if "!_ct!"=="codex"    goto :cc_codex
if "!_ct!"=="zed"      goto :cc_zed
if "!_ct!"=="kilo"     goto :cc_kilo
if "!_ct!"=="opencode" goto :cc_opencode
if "!_ct!"=="goose"    goto :cc_goose
if "!_ct!"=="pidev"    goto :cc_pidev
if "!_ct!"=="both"     goto :cc_both
if "!_ct!"=="all"      goto :cc_all
echo   ERROR: Unknown client type: !_ct! >&2
goto :eof

:cc_desktop
if not "!UNINSTALL!"=="true" ( echo   Client: Claude Desktop & echo   Config: !DESKTOP_CONFIG! )
call :_configure_one_path "!DESKTOP_CONFIG!" "!_sj!" "Claude Desktop"
goto :eof

:cc_code
if "!GLOBAL_CONFIG!"=="true" (
    if not "!UNINSTALL!"=="true" echo   Client: Claude Code ^(global^)
    if exist "!USERPROFILE!\.claude.json" (
        if not "!UNINSTALL!"=="true" echo   Config: !USERPROFILE!\.claude.json
        call :_configure_one_path "!USERPROFILE!\.claude.json" "!_sj!" "Claude Code (global)"
    )
    if exist "!USERPROFILE!\.claude\mcp.json" (
        if not "!UNINSTALL!"=="true" echo   Config: !USERPROFILE!\.claude\mcp.json
        call :_configure_one_path "!USERPROFILE!\.claude\mcp.json" "!_sj!" "Claude Code (global)"
    )
    if not exist "!USERPROFILE!\.claude.json" (
        if not exist "!USERPROFILE!\.claude\mcp.json" (
            if not "!UNINSTALL!"=="true" echo   Config: !USERPROFILE!\.claude.json
            call :_configure_one_path "!USERPROFILE!\.claude.json" "!_sj!" "Claude Code (global)"
        )
    )
) else (
    if not "!UNINSTALL!"=="true" ( echo   Client: Claude Code ^(workspace^) & echo   Config: !CODE_CONFIG! )
    call :_configure_one_path "!CODE_CONFIG!" "!_sj!" "Claude Code"
)
goto :eof

:cc_cursor
if not "!UNINSTALL!"=="true" ( echo   Client: Cursor & echo   Config: !CURSOR_CONFIG! )
call :_configure_one_path "!CURSOR_CONFIG!" "!_sj!" "Cursor"
goto :eof

:cc_windsurf
if not "!UNINSTALL!"=="true" ( echo   Client: Windsurf ^(global^) & echo   Config: !WINDSURF_CONFIG! )
call :_configure_one_path "!WINDSURF_CONFIG!" "!_sj!" "Windsurf"
goto :eof

:cc_vscode
if "!UNINSTALL!"=="true" (
    if exist "!VSCODE_CONFIG!" node "!JS_REMOVE_VSCODE!" "!VSCODE_CONFIG!"
) else (
    echo   Client: VS Code ^(workspace^)
    echo   Config: !VSCODE_CONFIG!
    echo   Note: for global VS Code config, use the VS Code command palette
    if exist "!VSCODE_CONFIG!" (
        for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
        copy /y "!VSCODE_CONFIG!" "!VSCODE_CONFIG!.backup.!_ts!" >nul
        echo   Backed up existing config
    )
    node "!JS_MERGE_VSCODE!" "!VSCODE_CONFIG!" "!_sj!"
    echo   OK: MCP config updated
)
goto :eof

:cc_gemini
if not "!UNINSTALL!"=="true" ( echo   Client: Gemini CLI & echo   Config: !GEMINI_CONFIG! )
call :_configure_one_path "!GEMINI_CONFIG!" "!_sj!" "Gemini CLI"
goto :eof

:cc_codex
if "!UNINSTALL!"=="true" (
    if exist "!CODEX_CONFIG!" node "!JS_REMOVE_CODEX!" "!CODEX_CONFIG!"
) else (
    echo   Client: OpenAI Codex CLI
    echo   Config: !CODEX_CONFIG!
    if exist "!CODEX_CONFIG!" (
        for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
        copy /y "!CODEX_CONFIG!" "!CODEX_CONFIG!.backup.!_ts!" >nul
        echo   Backed up existing config
    )
    node "!JS_MERGE_CODEX!" "!CODEX_CONFIG!" "!_sj!"
    echo   OK: MCP config updated
)
goto :eof

:cc_zed
if "!UNINSTALL!"=="true" (
    if exist "!ZED_CONFIG!" node "!JS_REMOVE_ZED!" "!ZED_CONFIG!"
) else (
    echo   Client: Zed ^(global^)
    echo   Config: !ZED_CONFIG!
    if exist "!ZED_CONFIG!" (
        for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
        copy /y "!ZED_CONFIG!" "!ZED_CONFIG!.backup.!_ts!" >nul
        echo   Backed up existing config
    )
    node "!JS_MERGE_ZED!" "!ZED_CONFIG!" "!_sj!"
    echo   OK: MCP config updated
)
goto :eof

:cc_kilo
if not "!UNINSTALL!"=="true" ( echo   Client: Kilo Code & echo   Config: !KILO_CONFIG! )
call :_configure_one_path "!KILO_CONFIG!" "!_sj!" "Kilo Code"
goto :eof

:cc_opencode
if "!UNINSTALL!"=="true" (
    if exist "!OPENCODE_CONFIG!" node "!JS_REMOVE_OC!" "!OPENCODE_CONFIG!"
) else (
    echo   Client: OpenCode
    echo   Config: !OPENCODE_CONFIG!
    if exist "!OPENCODE_CONFIG!" (
        for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
        copy /y "!OPENCODE_CONFIG!" "!OPENCODE_CONFIG!.backup.!_ts!" >nul
        echo   Backed up existing config
    )
    node "!JS_MERGE_OC!" "!OPENCODE_CONFIG!" "!_sj!"
    echo   OK: MCP config updated
)
goto :eof

:cc_goose
if not "!UNINSTALL!"=="true" ( echo   Client: Goose & echo   Config: !GOOSE_CONFIG! )
if "!UNINSTALL!"=="true" (
    if exist "!GOOSE_CONFIG!" (
        for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
        copy /y "!GOOSE_CONFIG!" "!GOOSE_CONFIG!.backup.!_ts!" >nul
        node "!JS_REMOVE_GOOSE!" "!GOOSE_CONFIG!"
    )
) else (
    if exist "!GOOSE_CONFIG!" (
        for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
        copy /y "!GOOSE_CONFIG!" "!GOOSE_CONFIG!.backup.!_ts!" >nul
        echo   Backed up existing config
    )
    node "!JS_MERGE_GOOSE!" "!GOOSE_CONFIG!" "!_sj!"
    echo   OK: MCP config updated
)
goto :eof

:cc_pidev
echo   Client: pi.dev
echo.
echo   pi.dev does not support MCP servers natively.
echo   pi.dev uses TypeScript extensions and CLI tools instead.
echo   To use CEAuto concepts in pi.dev, see: https://pi.dev/docs/extensions
echo.
goto :eof

:cc_both
call :configure_client "claudedesktop" "!_sj!"
echo.
call :configure_client "claude" "!_sj!"
goto :eof

:cc_all
call :configure_client "claudedesktop" "!_sj!"
echo.
call :configure_client "claude" "!_sj!"
if "!UNINSTALL!"=="true" (
    echo. & call :configure_client "cursor" "!_sj!"
    echo. & call :configure_client "windsurf" "!_sj!"
    echo. & call :configure_client "vscode" "!_sj!"
    echo. & call :configure_client "gemini" "!_sj!"
    echo. & call :configure_client "codex" "!_sj!"
    echo. & call :configure_client "zed" "!_sj!"
    echo. & call :configure_client "kilo" "!_sj!"
    echo. & call :configure_client "opencode" "!_sj!"
    echo. & call :configure_client "goose" "!_sj!"
) else (
    if exist "!_PARENT!\.cursor\mcp.json" ( echo. & call :configure_client "cursor" "!_sj!" )
    if exist "!USERPROFILE!\.cursor\mcp.json" ( echo. & call :configure_client "cursor" "!_sj!" )
    if exist "!WINDSURF_CONFIG!" ( echo. & call :configure_client "windsurf" "!_sj!" )
    if exist "!VSCODE_CONFIG!" ( echo. & call :configure_client "vscode" "!_sj!" )
    if exist "!_PARENT!\.gemini\settings.json" ( echo. & call :configure_client "gemini" "!_sj!" )
    if exist "!USERPROFILE!\.gemini\settings.json" ( echo. & call :configure_client "gemini" "!_sj!" )
    if exist "!_PARENT!\.codex\config.toml" ( echo. & call :configure_client "codex" "!_sj!" )
    if exist "!USERPROFILE!\.codex\config.toml" ( echo. & call :configure_client "codex" "!_sj!" )
    if exist "!ZED_CONFIG!" ( echo. & call :configure_client "zed" "!_sj!" )
    if exist "!KILO_CONFIG!" ( echo. & call :configure_client "kilo" "!_sj!" )
    if exist "!OPENCODE_CONFIG!" ( echo. & call :configure_client "opencode" "!_sj!" )
    if exist "!USERPROFILE!\.config\opencode\opencode.json" ( echo. & call :configure_client "opencode" "!_sj!" )
    if exist "!GOOSE_CONFIG!" ( echo. & call :configure_client "goose" "!_sj!" )
)
goto :eof

rem ════════════════════════════════════════════════════════
rem Subroutine: _configure_one_path <config_path> <server_js> [label]
:_configure_one_path
set "_cfg=%~1"
set "_sj2=%~2"
set "_lbl=%~3"

if "!UNINSTALL!"=="true" (
    if exist "!_cfg!" (
        for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
        copy /y "!_cfg!" "!_cfg!.backup.!_ts!" >nul
        node "!JS_REMOVE!" "!_cfg!" "!_lbl!"
    )
    goto :eof
)

if exist "!_cfg!" (
    if not "!FORCE!"=="true" (
        for /f "usebackq delims=" %%R in (`node "!JS_CHECK!" "!_cfg!" "!_sj2!" 2^>nul`) do set "_chk=%%R"
        if "!_chk!"=="uptodate" ( echo   MCP config already up to date & goto :eof )
        if "!_chk!"=="changed"  ( echo   Updating MCP config ^(server path changed^) )
    )
)

if exist "!_cfg!" (
    for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
    copy /y "!_cfg!" "!_cfg!.backup.!_ts!" >nul
    echo   Backed up existing config
)

node "!JS_MERGE!" "!_cfg!" "!_sj2!"
echo   OK: MCP config updated
goto :eof
