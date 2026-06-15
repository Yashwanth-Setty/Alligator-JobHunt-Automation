from agents.base_agent import BaseAgent
from scrapers.ats import scrape_ashby


class AshbyAgent(BaseAgent):
    def __init__(self):
        super().__init__("Ashby")

    def scrape(self):
        return scrape_ashby()


if __name__ == "__main__":
    AshbyAgent().run()
