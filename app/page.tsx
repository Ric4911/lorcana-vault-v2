"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Card = {
  id: string;
  name: string;
  set: string;
  number: string;
  quantity: number;
  foil: number;
  condition: string;
  binder: string;
  box: string;
  value: number;
};

type PendingCard = Pick<Card, "name" | "set" | "number">;

export default function Home() {
  const [cards, setCards] = useState<Card[]>([]);
  const [name, setName] = useState("");
  const [set, setSet] = useState("");
  const [number, setNumber] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [foil, setFoil] = useState(0);
  const [condition, setCondition] = useState("Near Mint");
  const [binder, setBinder] = useState("");
  const [box, setBox] = useState("");
  const [value, setValue] = useState(0);
  const [search, setSearch] = useState("");

  /* Loading device-only localStorage after hydration requires this one state-setting effect. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = localStorage.getItem("lorcanaCards");
    if (saved) setCards(JSON.parse(saved));

    const pending = localStorage.getItem("lorcanaPendingCard");
    if (pending) {
      try {
        const scanned: PendingCard = JSON.parse(pending);
        setName(scanned.name || "");
        setSet(scanned.set || "");
        setNumber(scanned.number || "");
      } finally {
        localStorage.removeItem("lorcanaPendingCard");
      }
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    localStorage.setItem("lorcanaCards", JSON.stringify(cards));
  }, [cards]);

  function addCard() {
    if (!name.trim()) return;

    const newCard: Card = {
      id: crypto.randomUUID(),
      name,
      set,
      number,
      quantity,
      foil,
      condition,
      binder,
      box,
      value,
    };

    setCards([newCard, ...cards]);

    setName("");
    setSet("");
    setNumber("");
    setQuantity(1);
    setFoil(0);
    setCondition("Near Mint");
    setBinder("");
    setBox("");
    setValue(0);
  }

  function deleteCard(id: string) {
    setCards(cards.filter((card) => card.id !== id));
  }

  const filteredCards = cards.filter((card) =>
    card.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalCards = cards.reduce((sum, card) => sum + card.quantity, 0);
  const totalValue = cards.reduce(
    (sum, card) => sum + card.quantity * card.value,
    0
  );

  return (
    <main className="min-h-screen p-6 bg-slate-950 text-white">
      <h1 className="text-4xl font-bold mb-2">Lorcana Vault</h1>
      <p className="text-slate-400 mb-6">
        Track cards, binders, boxes, foils and collection value.
      </p>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <div className="bg-slate-900 rounded-xl p-4">
          <p className="text-slate-400">Unique Cards</p>
          <p className="text-3xl font-bold">{cards.length}</p>
        </div>

        <div className="bg-slate-900 rounded-xl p-4">
          <p className="text-slate-400">Total Cards</p>
          <p className="text-3xl font-bold">{totalCards}</p>
        </div>

        <div className="bg-slate-900 rounded-xl p-4">
          <p className="text-slate-400">Collection Value</p>
          <p className="text-3xl font-bold">£{totalValue.toFixed(2)}</p>
        </div>
      </div>
<div className="grid gap-4 md:grid-cols-4 mb-6">
  <Link
  href="/scan"
  className="bg-yellow-400 text-black font-bold rounded-xl p-4 text-center"
>
  📷 Scan Cards
</Link>

  <button className="bg-slate-900 rounded-xl p-4">
    📚 Collection
  </button>

  <button className="bg-slate-900 rounded-xl p-4">
    🃏 Deck Builder
  </button>

  <button className="bg-slate-900 rounded-xl p-4">
    💰 Value Tracker
  </button>
</div>
      <section className="bg-slate-900 rounded-xl p-4 mb-6">
        <h2 className="text-2xl font-bold mb-4">Add Card</h2>

        <div className="grid gap-3 md:grid-cols-3">
          <input className="p-3 rounded text-white bg-slate-800 border border-slate-700" placeholder="Card name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="p-3 rounded text-white bg-slate-800 border border-slate-700" placeholder="Set" value={set} onChange={(e) => setSet(e.target.value)} />
          <input className="p-3 rounded text-white bg-slate-800 border border-slate-700" placeholder="Card number" value={number} onChange={(e) => setNumber(e.target.value)} />

          <input className="p-3 rounded text-white bg-slate-800 border border-slate-700" type="number" placeholder="Quantity" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          <input className="p-3 rounded text-white bg-slate-800 border border-slate-700" type="number" placeholder="Foil quantity" value={foil} onChange={(e) => setFoil(Number(e.target.value))} />
          <input className="p-3 rounded text-white bg-slate-800 border border-slate-700" placeholder="Condition" value={condition} onChange={(e) => setCondition(e.target.value)} />

          <input className="p-3 rounded text-white bg-slate-800 border border-slate-700" placeholder="Binder location" value={binder} onChange={(e) => setBinder(e.target.value)} />
          <input className="p-3 rounded text-white bg-slate-800 border border-slate-700" placeholder="Box location" value={box} onChange={(e) => setBox(e.target.value)} />
          <input className="p-3 rounded text-white bg-slate-800 border border-slate-700" type="number" placeholder="Value £" value={value} onChange={(e) => setValue(Number(e.target.value))} />
        </div>

        <button onClick={addCard} className="mt-4 bg-yellow-400 text-black font-bold rounded-xl px-6 py-3">
          Add to Vault
        </button>
      </section>

      <input
        className="w-full p-3 rounded text-black mb-4"
        placeholder="Search collection..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <section className="grid gap-3">
        {filteredCards.map((card) => (
          <div key={card.id} className="bg-slate-900 rounded-xl p-4 flex justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold">{card.name}</h3>
              <p className="text-slate-400">
                {card.set} #{card.number} · Qty {card.quantity} · Foil {card.foil}
              </p>
              <p className="text-slate-400">
                {card.condition} · Binder: {card.binder || "-"} · Box: {card.box || "-"}
              </p>
              <p className="text-yellow-300">
                £{(card.quantity * card.value).toFixed(2)}
              </p>
            </div>

            <button onClick={() => deleteCard(card.id)} className="text-red-400">
              Delete
            </button>
          </div>
        ))}
      </section>
    </main>
  );
}
