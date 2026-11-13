# TODO

1. [x] přepínátko na světlý/tmavý režim přesuneme vedle user avatara a dáme to jako IconButton se sluníčkem pokud mám tmavý režim a měsíčkem pokud mám světlý režim (main@5f12691)
2. [x] Badge "Admin" vedle user avatara nahradíme za zlatou korunku nasazenou na kolečko user vatara pod 45 stupněma nahoře v pravo aby to vypadalo že to má nasazeno na hlavě (main@fb5fec2)
3. [x] přepínátko jazyků přesuneme do dialogu nastavení (main@663d1c0)
4. [x] Option "Správa ->" z user dropdownu smažeme a místo toho uděláme novou záložku v TopBaru, kterou uvidí jen správci (main@5341d7c)
5. [x] Přepínátko Kalendář / Seznam na stránce /reservations přepíná vlastně jen zobrazení mých rezervací. Současnou sekci moje rezervace stolů přejmenujeme a uděláme z toho seznam mých rezervací, kde se budou zobrazovat jak rezervace stolů, tak rezervace na parkování a bude to opět oddělené ikonkami.To vlastně znamená, že v seznamovém Zobrazení není potřeba první nadpis moje rezervace, protože moje rezervace je nadpis celé stránky. (main@9e60703)
6. [x] Na stránce moje rezervace v zobrazení kalendáři musíme barevně odlišit rezervaci na parkování a rezervaci na stůl. V událostech nepotřebujeme textový popis, parkování nebo stůl, stačí nám ikonka a id daného místa. (main@f4e40bf)
7. [x] Na stránce moje rezervace bych měl mít možnost zobrazit si detail rezervace i v kalendářovém zobrazení. Zabrazíme to v nějakém dialogu, kde budu mít možnost i rezervaci zrušit. Co se detailu rezervace na stůl týká. Líbilo by se mi tam, kdybych měl možnost kliknout na tlačítko Zobrazit na plánku a aplikace by mě přesměrovala do stránky stoly, kde by mi automaticky ukázala dané místo na plánku. (main@f5a6aae)
8. [x] Dialog hromadné rezervace stolů trošku upravíme a v sekci pro koho rezervovat zobrazíme vlastně jen multiSelect s uživateli. Čisto teoreticky môžeme zrušiť celú tú sekci a mysto ní zobrazíme i jeden multiselekt. (main@bfcb5c8)
9. [x] V dialogu hromadné rezervace, stolů i parkovacích míst i vybíráku datumu chceme vždy zvýraznit dnešní datum. Stačí nějaký border okolo aktuálního data v kalendáři. Stejně tak zvýrazíme i dnešní datum na stránce moje rezervace v kalendářovém zobrazení. (main@2bfdc58)
10. [ ] V dialogu návrh rozvrhu by měl mít admin vždy možnost vygenerovaný stůl změnit. To znamená, že vždy tam zobrazím vybíráko stolů s předvyplněnou hodnou. A pokud je přihlášený uživatel admin, měli mít možnost to změnit. stejně tak i pro návrh rozvrhu pro parkovací místa
11. [ ] Dialogy nejdou zavřít klikem vně a nemají close button.
12. [ ] Sjednoť tlačitka na otevření dialogů hromadných rezervací pro parkování i pro stoly ať vypadají stejně.
13. [ ] korunka v dropdownu uživatele v prabo nahoře v topBaru má být nad kruhem s avatarem uživatele (resp jeho iniciály) a né až za jménem
14. [ ] Uklidit v repu MD soubory stejným způsobem jakým jsme to dělali v session 0a229e9c-c44e-4f1b-a96f-a7729cc55945
