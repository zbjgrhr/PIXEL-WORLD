interface StageHeadingProps {
  number?: string
  title: string
  english?: string
}

export default function StageHeading({ number, title, english }: StageHeadingProps) {
  return <h2 className="stage-heading">
    {number && <span className="stage-heading-number" aria-hidden="true">{number}</span>}
    <span className="stage-heading-copy">
      <strong>{title}</strong>
      {english && <small>{english}</small>}
    </span>
  </h2>
}
