# Orbit Lab

A Mac app for playing with orbital mechanics in 3D: plan Hohmann transfers, lunar gravity assists and rendezvous burns, then watch a reinforcement-learning agent learn to dock with a space station.

| Hohmann Transfer | Gravity Assist |
|---|---|
| ![Hohmann transfer from low orbit to geostationary](docs/images/hohmann.png) | ![Lunar flyby that flings the craft out of Earth orbit](docs/images/gravity-assist.png) |
| **Rendezvous** | **Docking Agent** |
| ![Phasing and transfer to catch a station](docs/images/rendezvous.png) | ![PPO agent learning to dock, with its success curve](docs/images/docking.png) |

```mermaid
flowchart LR
  P[Plan<br/>Hohmann · flyby · rendezvous] --> F[Fly it<br/>Earth–Moon physics]
  F -->|arrive 40 m behind the port| D[Docking agent<br/>PPO, trains live]
```

- **[Try it in your browser](https://amalmehta.github.io/OrbitLab/)**
- **[How to set up, run and use it](docs/INSTRUCTIONS.md)**
- **[System design](docs/SYSTEM-DESIGN.md)**: architecture, physics, RL and trade-offs
- **[What's where](docs/FILE-STRUCTURE.md)**
