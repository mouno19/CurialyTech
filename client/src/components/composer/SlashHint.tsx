// The composers' slash commands: typing "/" lists the ones that apply here, and picking one starts
// the message with it (the text after it is the command's argument).

export type SlashCommand = { name: string; argument: string; hint: string };

export function SlashHint({ text, commands, onPick }: { text: string; commands: SlashCommand[]; onPick: (text: string) => void }) {
  const typed = /^\/([a-z]*)$/i.exec(text.trim())?.[1]?.toLowerCase();
  if (typed === undefined) return null;
  const matches = commands.filter(command => command.name.startsWith(typed));
  if (!matches.length) return null;
  return (
    <div className="slash-hint" role="group" aria-label="Commands">
      {matches.map(command => (
        <button key={command.name} type="button" className="slash-hint-item" onMouseDown={event => event.preventDefault()} onClick={() => onPick(`/${command.name} `)}>
          <span className="mono">/{command.name} <span className="slash-hint-arg">{command.argument}</span></span>
          <span className="slash-hint-text">{command.hint}</span>
        </button>
      ))}
    </div>
  );
}
